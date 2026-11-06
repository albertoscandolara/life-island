import { randomUUID } from 'node:crypto';
import {
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
  UnsupportedMediaTypeException,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import {
  enqueueEvent,
  withTransaction,
  type ObjectStorage,
  type ServiceDb,
} from '@life-island/be-common';
import {
  CATEGORY_DIMENSION_LABELS,
  CategoryHierarchy,
  createUploadRequestSchema,
  dimensionConflicts,
  fileFormatFromFilename,
  fileFormatFromMime,
  listUploadsQuerySchema,
  MAX_UPLOAD_BYTES,
  reparseUploadsRequestSchema,
  categoryDecisionsSchema,
  updateUploadRequestSchema,
  UPLOAD_COMPLETED_EVENT,
  UPLOAD_REPARSE_REQUESTED_EVENT,
  type CategoryDecisions,
  type CompleteUploadResponse,
  type CreateUploadResponse,
  type Page,
  type ReparseUploadsResponse,
  type UploadCompletedV1,
  type UploadReparseRequestedV1,
  type UploadDto,
} from '@life-island/contracts';
import {
  assertWritable,
  categorySuggestions,
  documentCategories,
  editFieldValues,
  enqueueUploadDeleted,
  enqueueUploadUpdated,
  FieldEditError,
  syncTemplateFields,
  toUploadDto,
  uploads,
  type UploadRow,
} from '@life-island/ingestion-db';
import { and, count, desc, eq, inArray, lt, ne, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import type pg from 'pg';
import type { z } from 'zod';
import {
  CONFIG,
  SERVICE_DB,
  STORAGE,
  type IngestionConfig,
} from '../config.js';
import { CategoriesService } from '../categories/categories.service.js';
import { inspectFile } from './file-inspection.js';

type CreateUpload = z.output<typeof createUploadRequestSchema>;
type ListUploads = z.output<typeof listUploadsQuerySchema>;
type UpdateUpload = z.output<typeof updateUploadRequestSchema>;
type ReparseUploads = z.output<typeof reparseUploadsRequestSchema>;

function titleFromFilename(filename: string): string {
  const base = filename
    .replace(/\.[^.]+$/, '')
    .replace(/[_-]+/g, ' ')
    .trim();
  return (base || filename).slice(0, 200);
}

/** A storage-friendly version of the file name: no paths, no odd characters. */
export function safeFilename(filename: string): string {
  const base = filename.split(/[\\/]/).pop() ?? '';
  const cleaned = base
    .normalize('NFKD')
    .replace(/[^\w.-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[.-]+/, '')
    .slice(-120);
  return cleaned || 'file';
}

function isUniqueViolation(error: unknown): boolean {
  const code =
    (error as { code?: string; cause?: { code?: string } }).code ??
    (error as { cause?: { code?: string } }).cause?.code;
  return code === '23505';
}

@Injectable()
export class UploadsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(UploadsService.name);
  private cleanupTimer?: NodeJS.Timeout;

  constructor(
    @Inject(SERVICE_DB) private readonly svc: ServiceDb,
    @Inject(STORAGE) private readonly storage: ObjectStorage,
    @Inject(CONFIG) private readonly config: IngestionConfig,
    @Inject(CategoriesService) private readonly categories: CategoriesService,
  ) {}

  onModuleInit(): void {
    this.cleanupTimer = setInterval(
      () =>
        void this.failStaleUploads().catch((error) => this.logger.error(error)),
      10 * 60 * 1000,
    );
    this.cleanupTimer.unref();
  }

  onModuleDestroy(): void {
    clearInterval(this.cleanupTimer);
  }

  /** Step 1: register the file and hand out a presigned URL the browser uploads to. */
  async create(request: CreateUpload): Promise<CreateUploadResponse> {
    const format =
      fileFormatFromMime(request.mimeType) ??
      fileFormatFromFilename(request.filename);
    if (!format) {
      throw new UnsupportedMediaTypeException(
        `"${request.filename}" is not a supported format (images, PDF, Excel, CSV, Word, text)`,
      );
    }
    const id = randomUUID();
    const now = new Date();
    const month = String(now.getUTCMonth() + 1).padStart(2, '0');
    // The original name stays last in the key, so downloads keep it.
    const storageKey = `${now.getUTCFullYear()}/${month}/${id}/${safeFilename(request.filename)}`;
    await withTransaction(this.svc.pool, async (client) => {
      await assertWritable(client);
      await drizzle(client)
        .insert(uploads)
        .values({
          id,
          title: request.title ?? titleFromFilename(request.filename),
          description: request.description ?? null,
          originalFilename: request.filename,
          declaredMime: request.mimeType,
          sizeBytes: request.sizeBytes,
          storageKey,
        });
    });
    const expiresInSeconds = 15 * 60;
    return {
      uploadId: id,
      uploadUrl: await this.storage.presignPut(
        storageKey,
        request.mimeType,
        expiresInSeconds,
      ),
      uploadHeaders: { 'Content-Type': request.mimeType },
      expiresAt: new Date(Date.now() + expiresInSeconds * 1000).toISOString(),
    };
  }

  /**
   * Step 2, after the browser PUT: check the stored bytes, detect the real
   * format, hash it, and either mark it TO_BE_PARSED (emitting upload.completed)
   * or, if the same file was uploaded before, drop this copy and return the earlier one.
   */
  async complete(id: string): Promise<CompleteUploadResponse> {
    const row = await this.findRow(id);
    if (row.status !== 'UPLOADING')
      return { upload: toUploadDto(row), duplicate: false };
    await withTransaction(this.svc.pool, (client) => assertWritable(client));

    const head = await this.storage.head(row.storageKey);
    if (!head)
      throw new ConflictException('The file has not reached storage yet');
    if (head.sizeBytes > MAX_UPLOAD_BYTES) {
      return this.reject(
        row,
        `File is larger than ${MAX_UPLOAD_BYTES / 1024 / 1024} MB`,
      );
    }

    const bytes = await this.storage.getBytes(row.storageKey);
    const inspected = await inspectFile(bytes, {
      mime: row.declaredMime,
      filename: row.originalFilename,
    });
    if (!inspected)
      return this.reject(row, 'The file content is not a supported format');

    const existing = await this.svc.db
      .select()
      .from(uploads)
      .where(and(eq(uploads.sha256, inspected.sha256), ne(uploads.id, id)))
      .limit(1);
    if (existing[0]) {
      // A document whose parsing failed is retried rather than returned as is:
      // uploading the same file again is how you ask for another attempt.
      const original =
        existing[0].status === 'FAILED'
          ? await this.requeueFailed(existing[0])
          : existing[0];
      return this.dropDuplicate(row, original);
    }

    try {
      const updated = await withTransaction(this.svc.pool, async (client) => {
        await assertWritable(client);
        const [saved] = await drizzle(client)
          .update(uploads)
          .set({
            status: 'TO_BE_PARSED',
            fileFormat: inspected.format,
            detectedMime: inspected.mime,
            sizeBytes: bytes.length,
            sha256: inspected.sha256,
            uploadedAt: new Date(),
            updatedAt: new Date(),
          })
          .where(and(eq(uploads.id, id), eq(uploads.status, 'UPLOADING')))
          .returning();
        if (!saved) return undefined;
        const event: UploadCompletedV1 = {
          uploadId: saved.id,
          title: saved.title,
          description: saved.description,
          originalFilename: saved.originalFilename,
          fileFormat: inspected.format,
          sizeBytes: bytes.length,
          uploadedAt: (saved.uploadedAt ?? saved.createdAt).toISOString(),
        };
        await enqueueEvent(client, this.svc.schema, {
          type: UPLOAD_COMPLETED_EVENT,
          payload: event,
        });
        return saved;
      });
      // A concurrent complete call won the race; report what it stored.
      return {
        upload: toUploadDto(updated ?? (await this.findRow(id))),
        duplicate: false,
      };
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      // The same file was completed concurrently under another id.
      const [winner] = await this.svc.db
        .select()
        .from(uploads)
        .where(eq(uploads.sha256, inspected.sha256));
      return this.dropDuplicate(row, winner);
    }
  }

  async list(query: ListUploads): Promise<Page<UploadDto>> {
    const where = and(
      query.status ? eq(uploads.status, query.status) : undefined,
      // A category matches its descendants too: BILL lists water bills.
      query.category
        ? sql`${uploads.categories} && array(
            with recursive subtree (id) as (
              select ${query.category}::text
              union
              select c.id from ${documentCategories} c
                join subtree s on c.parent_id = s.id
            )
            select id from subtree)`
        : undefined,
    );
    const [rows, [{ total }]] = await Promise.all([
      this.svc.db
        .select()
        .from(uploads)
        .where(where)
        .orderBy(desc(uploads.createdAt))
        .limit(query.limit)
        .offset(query.offset),
      this.svc.db.select({ total: count() }).from(uploads).where(where),
    ]);
    return {
      items: rows.map(toUploadDto),
      total,
      limit: query.limit,
      offset: query.offset,
    };
  }

  async get(id: string): Promise<UploadDto> {
    return toUploadDto(await this.findRow(id));
  }

  /**
   * Your edits to a document: title, description, its confirmed categories
   * and extracted field values. One transaction saves them and tells the
   * review inbox through `upload.updated`. Changing the categories adds the
   * new ones' template fields as missing, for you to fill in.
   */
  async update(id: string, request: UpdateUpload): Promise<UploadDto> {
    const others = new Set<string>();
    const dto = await withTransaction(this.svc.pool, async (client) => {
      await assertWritable(client);
      const db = drizzle(client);
      const [row] = await db
        .select()
        .from(uploads)
        .where(eq(uploads.id, id))
        .for('update');
      if (!row) throw new NotFoundException(`Upload ${id} not found`);
      if (row.status === 'UPLOADING' || !row.fileFormat)
        throw new ConflictException('This upload has no stored file to edit');
      if (
        row.status === 'PARSING' &&
        (request.categories || request.fields || request.decisions)
      )
        throw new ConflictException(
          'The AI is processing this document right now; change its categories and fields once it finishes',
        );

      const decided = request.decisions
        ? await this.applyDecisions(client, row, request.decisions)
        : undefined;
      for (const uploadId of decided?.otherUploads ?? []) others.add(uploadId);
      const categoryIds = [
        ...new Set([
          ...(request.categories ?? decided?.categories ?? row.categories),
          ...(decided?.added ?? []),
        ]),
      ];
      const categoriesChanged =
        !!request.categories || categoryIds.join() !== row.categories.join();
      const assigned = categoryIds.length
        ? await db
            .select()
            .from(documentCategories)
            .where(inArray(documentCategories.id, categoryIds))
        : [];
      const unknown = categoryIds.filter(
        (categoryId) =>
          !assigned.some((category) => category.id === categoryId),
      );
      if (categoriesChanged && unknown.length)
        throw new UnprocessableEntityException(
          `Unknown categories: ${unknown.join(', ')}`,
        );
      // Every dimension is optional, but a document has at most one document
      // type and one issuer (a category with its ancestors counts as one).
      if (categoriesChanged) {
        const tree = new CategoryHierarchy(
          await db.select().from(documentCategories),
        );
        const [conflict] = dimensionConflicts(categoryIds, tree);
        if (conflict)
          throw new UnprocessableEntityException(
            `A document has at most one ${CATEGORY_DIMENSION_LABELS[conflict.dimension].toLowerCase()}: ${conflict.categoryIds.join(', ')} are unrelated ones. Keep one (its parent categories may stay).`,
          );
      }
      // Keep the order you gave.
      const ordered = categoryIds.flatMap((categoryId) =>
        assigned
          .filter((category) => category.id === categoryId)
          .map((category) => ({
            id: category.id,
            template: category.templateJson,
          })),
      );

      let extractedFields = row.extractedFields;
      if (categoriesChanged)
        extractedFields = syncTemplateFields(extractedFields, ordered);
      if (request.fields && Object.keys(request.fields).length) {
        try {
          extractedFields = editFieldValues(
            extractedFields,
            request.fields,
            ordered.flatMap((category) => category.template.fields),
          );
        } catch (error) {
          if (error instanceof FieldEditError)
            throw new UnprocessableEntityException(error.message);
          throw error;
        }
      }

      const [saved] = await db
        .update(uploads)
        .set({
          ...(request.title !== undefined ? { title: request.title } : {}),
          ...(request.description !== undefined
            ? { description: request.description }
            : {}),
          ...(categoriesChanged ? { categories: categoryIds } : {}),
          ...(decided?.historical ?? {}),
          // Ticking a category by hand overrides an earlier decline of it.
          rejectedCategories: [
            ...new Set([...(decided?.rejected ?? row.rejectedCategories)]),
          ].filter((categoryId) => !categoryIds.includes(categoryId)),
          extractedFields,
          updatedAt: new Date(),
        })
        .where(eq(uploads.id, id))
        .returning();
      await enqueueUploadUpdated(client, this.svc.schema, [id]);
      others.delete(id);
      // Other documents that suggested a category you approved got it too.
      if (others.size) await this.categories.resyncUploads(client, [...others]);
      return toUploadDto(saved);
    });
    return dto;
  }

  /**
   * Your decisions on a document's suggested categories, sent once with the
   * review panel's Confirm. Approved parser suggestions become categories in
   * one taxonomy version (and join every document that suggested them);
   * declined ones are declined for this document only. Accepted historical
   * findings join the document; rejected ones are remembered so they are
   * never proposed for it again. When no finding is left undecided the
   * historical review is complete, rejected or not: the document counts as
   * checked against the version it was processed for (never a newer one).
   */
  private async applyDecisions(
    client: pg.PoolClient,
    row: UploadRow,
    decisions: CategoryDecisions,
  ): Promise<{
    categories: string[];
    added: string[];
    rejected: string[];
    otherUploads: string[];
    historical?: Partial<UploadRow>;
  }> {
    const parsed = categoryDecisionsSchema.parse(decisions);
    const both = parsed.approveSuggestions.filter((suggestionId) =>
      parsed.declineSuggestions.includes(suggestionId),
    );
    const contradicting = parsed.acceptHistorical.filter((categoryId) =>
      parsed.rejectHistorical.includes(categoryId),
    );
    if (both.length || contradicting.length)
      throw new UnprocessableEntityException(
        'A suggestion cannot be accepted and declined at once',
      );
    const db = drizzle(client);
    const decidedSuggestions = [
      ...parsed.approveSuggestions,
      ...parsed.declineSuggestions,
    ];
    if (decidedSuggestions.length) {
      const mine = await db
        .select({ id: categorySuggestions.id })
        .from(categorySuggestions)
        .where(
          and(
            inArray(categorySuggestions.id, decidedSuggestions),
            eq(categorySuggestions.status, 'PENDING'),
            sql`${row.id}::uuid = any(${categorySuggestions.uploadIds})`,
          ),
        );
      const missing = decidedSuggestions.filter(
        (suggestionId) =>
          !mine.some((suggestion) => suggestion.id === suggestionId),
      );
      if (missing.length)
        throw new ConflictException(
          'Some suggested categories were already decided or are no longer suggested for this document; reload it and try again',
        );
    }
    for (const suggestionId of parsed.declineSuggestions)
      await this.categories.dismissInTransaction(client, suggestionId, row.id);
    let otherUploads: string[] = [];
    let added: string[] = [];
    if (parsed.approveSuggestions.length) {
      const approved = await this.categories.approveInTransaction(
        client,
        parsed.approveSuggestions.map((suggestionId) => ({ id: suggestionId })),
      );
      added = approved.categoryIds;
      otherUploads = approved.uploadIds;
    }
    const [fresh] = await db
      .select()
      .from(uploads)
      .where(eq(uploads.id, row.id));

    const historicalDecided = [
      ...parsed.acceptHistorical,
      ...parsed.rejectHistorical,
    ];
    let historical: Partial<UploadRow> | undefined;
    let rejected = fresh.rejectedCategories;
    if (historicalDecided.length) {
      if (fresh.historicalStatus !== 'PENDING_REVIEW')
        throw new ConflictException(
          'This document has no newer categories waiting for review',
        );
      const offered = fresh.historicalSuggestions.map(
        (suggestion) => suggestion.categoryId,
      );
      const unknown = historicalDecided.filter(
        (categoryId) => !offered.includes(categoryId),
      );
      if (unknown.length)
        throw new UnprocessableEntityException(
          `Not suggested for this document: ${unknown.join(', ')}`,
        );
      // A category deleted since it was found can no longer be added.
      const existing = parsed.acceptHistorical.length
        ? (
            await db
              .select({ id: documentCategories.id })
              .from(documentCategories)
              .where(inArray(documentCategories.id, parsed.acceptHistorical))
          ).map((category) => category.id)
        : [];
      added = [
        ...added,
        ...parsed.acceptHistorical.filter((categoryId) =>
          existing.includes(categoryId),
        ),
      ];
      rejected = [...new Set([...rejected, ...parsed.rejectHistorical])];
      const remaining = fresh.historicalSuggestions.filter(
        (suggestion) => !historicalDecided.includes(suggestion.categoryId),
      );
      historical = remaining.length
        ? { historicalSuggestions: remaining }
        : {
            historicalStatus: null,
            historicalSuggestions: [],
            historicalReviewedVersion: fresh.historicalProcessingVersion,
            historicalProcessingVersion: null,
            historicalRunId: null,
          };
    }
    return {
      categories: fresh.categories,
      added,
      rejected,
      otherUploads,
      historical,
    };
  }

  /**
   * Sends parsed documents back to the parse queue, to be read again from
   * scratch: the AI reassigns their categories and re-extracts their fields.
   * What the last run produced (categories, analysis, fields, target data,
   * flags, completed steps) is cleared; title and description stay. Pending
   * category suggestions forget these documents, and a suggestion left with
   * none is dropped (not rejected: the AI may propose it again). Only PARSED
   * and FAILED documents qualify (a failure is worth a new try once its cause
   * is fixed, such as the parser or its API key); the others are reported as
   * skipped. One transaction tells the review inbox through `upload.reparse_requested` and
   * `upload.updated`. The worker picks them up on its next run (or Parse now).
   */
  async reparse(request: ReparseUploads): Promise<ReparseUploadsResponse> {
    const ids = [...new Set(request.uploadIds)];
    return withTransaction(this.svc.pool, async (client) => {
      await assertWritable(client);
      const now = new Date();
      const requeued = await drizzle(client)
        .update(uploads)
        .set({
          status: 'TO_BE_PARSED',
          attempts: 0,
          nextAttemptAt: now,
          lastAttemptAt: null,
          lastError: null,
          categories: [],
          completedSteps: [],
          currentStep: null,
          analysis: null,
          extractedFields: null,
          targetKey: null,
          details: null,
          confidence: null,
          flags: [],
          parsedAt: null,
          // Read from scratch, so its CLASSIFY sees every category: what a
          // later check found no longer matters. Declines stay.
          classifiedCategoryVersion: null,
          historicalStatus: null,
          historicalSuggestions: [],
          historicalProcessingVersion: null,
          historicalRunId: null,
          updatedAt: now,
        })
        // Only finished documents (read, or failed): never one the worker holds.
        .where(
          and(
            inArray(uploads.id, ids),
            inArray(uploads.status, ['PARSED', 'FAILED']),
          ),
        )
        .returning({ id: uploads.id });
      const requeuedIds = requeued.map((row) => row.id);
      if (requeuedIds.length) {
        await client.query(
          `update ingestion.category_suggestions
              set upload_ids = array(select id from unnest(upload_ids) as id
                                      where id <> all($1::uuid[])),
                  updated_at = now()
            where status = 'PENDING' and upload_ids && $1::uuid[]`,
          [requeuedIds],
        );
        await client.query(
          `delete from ingestion.category_suggestions
            where status = 'PENDING' and cardinality(upload_ids) = 0`,
        );
        for (const uploadId of requeuedIds) {
          const event: UploadReparseRequestedV1 = {
            uploadId,
            requestedAt: now.toISOString(),
          };
          await enqueueEvent(client, this.svc.schema, {
            type: UPLOAD_REPARSE_REQUESTED_EVENT,
            payload: event,
          });
        }
        await enqueueUploadUpdated(client, this.svc.schema, requeuedIds);
        this.logger.log(
          `Sent ${requeuedIds.length} document(s) back to the parse queue`,
        );
      }
      const sent = new Set(requeuedIds);
      return {
        requeued: ids.filter((id) => sent.has(id)),
        skipped: ids.filter((id) => !sent.has(id)),
      };
    });
  }

  /**
   * Deletes a document: its row, its parse history and its file. The review
   * inbox learns it through `upload.deleted`; data a module already loaded
   * from it stays in that module. Not while the AI is reading it.
   */
  async remove(id: string): Promise<void> {
    const storageKey = await withTransaction(this.svc.pool, async (client) => {
      await assertWritable(client);
      const db = drizzle(client);
      const [row] = await db
        .select()
        .from(uploads)
        .where(eq(uploads.id, id))
        .for('update');
      if (!row) throw new NotFoundException(`Upload ${id} not found`);
      if (row.status === 'PARSING')
        throw new ConflictException(
          'The AI is processing this document right now; delete it once it finishes',
        );
      // Pending suggestions forget it; one left with no document is dropped.
      await client.query(
        `update ingestion.category_suggestions
              set upload_ids = array_remove(upload_ids, $1::uuid), updated_at = now()
            where status = 'PENDING' and $1::uuid = any(upload_ids)`,
        [id],
      );
      await db
        .update(categorySuggestions)
        .set({
          status: 'REJECTED',
          reviewedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(categorySuggestions.status, 'PENDING'),
            sql`cardinality(${categorySuggestions.uploadIds}) = 0`,
          ),
        );
      await db.delete(uploads).where(eq(uploads.id, id));
      // Nothing downstream knows an upload whose file never arrived.
      if (row.status !== 'UPLOADING' && row.fileFormat)
        await enqueueUploadDeleted(client, this.svc.schema, id);
      return row.storageKey;
    });
    await this.storage
      .delete(storageKey)
      .catch((error: unknown) =>
        this.logger.warn(
          `Deleted upload ${id} but not its file ${storageKey}: ${String(error)}`,
        ),
      );
  }

  /** A short-lived presigned link to the original file. */
  async fileUrl(id: string): Promise<string> {
    const row = await this.storedRow(id);
    return this.storage.presignGet(row.storageKey, {
      filename: row.originalFilename,
      contentType: row.detectedMime ?? undefined,
    });
  }

  /**
   * The original file, streamed from storage with the headers the browser
   * needs: `inline` shows it (preview), `attachment` saves it under its
   * original name (download). Served by the API rather than a presigned
   * redirect because not every S3 implementation honours the overridden
   * headers (SeaweedFS ignores them), and so previews stay same-origin.
   */
  async openFile(id: string, disposition: 'inline' | 'attachment') {
    const row = await this.storedRow(id);
    const stored = await this.storage.getStream(row.storageKey);
    if (!stored) throw new NotFoundException('The stored file is missing');
    const mime = row.detectedMime ?? 'application/octet-stream';
    return {
      body: stored.body,
      sizeBytes: stored.sizeBytes,
      // Browsers download text/csv even inline; plain text they show.
      contentType:
        disposition === 'inline' && row.fileFormat === 'CSV'
          ? 'text/plain; charset=utf-8'
          : mime.startsWith('text/')
            ? `${mime}; charset=utf-8`
            : mime,
      contentDisposition: `${disposition}; filename*=UTF-8''${encodeURIComponent(row.originalFilename)}`,
    };
  }

  /** Marks uploads the browser never finished as FAILED. */
  async failStaleUploads(): Promise<number> {
    const cutoff = new Date(
      Date.now() - this.config.staleUploadMinutes * 60 * 1000,
    );
    const stale = await this.svc.db
      .update(uploads)
      .set({
        status: 'FAILED',
        lastError: 'Upload was never completed',
        updatedAt: new Date(),
      })
      .where(
        and(eq(uploads.status, 'UPLOADING'), lt(uploads.createdAt, cutoff)),
      )
      .returning({ id: uploads.id });
    if (stale.length)
      this.logger.log(`Marked ${stale.length} stale uploads as FAILED`);
    return stale.length;
  }

  /** The row of an upload whose file is in storage (completed, even if parsing failed later). */
  private async storedRow(id: string): Promise<UploadRow> {
    const row = await this.findRow(id);
    if (row.status === 'UPLOADING' || !row.sha256) {
      throw new NotFoundException('This upload has no stored file');
    }
    return row;
  }

  private async findRow(id: string): Promise<UploadRow> {
    const [row] = await this.svc.db
      .select()
      .from(uploads)
      .where(eq(uploads.id, id));
    if (!row) throw new NotFoundException(`Upload ${id} not found`);
    return row;
  }

  private async reject(row: UploadRow, reason: string): Promise<never> {
    await this.svc.db
      .update(uploads)
      .set({ status: 'FAILED', lastError: reason, updatedAt: new Date() })
      .where(eq(uploads.id, row.id));
    await this.storage.delete(row.storageKey).catch(() => undefined);
    throw new UnprocessableEntityException(reason);
  }

  /** Puts a FAILED document back in the parse queue, from its first unfinished step. */
  private async requeueFailed(row: UploadRow): Promise<UploadRow> {
    const [requeued] = await this.svc.db
      .update(uploads)
      .set({
        status: 'TO_BE_PARSED',
        attempts: 0,
        lastError: null,
        nextAttemptAt: new Date(),
        updatedAt: new Date(),
      })
      .where(and(eq(uploads.id, row.id), eq(uploads.status, 'FAILED')))
      .returning();
    return requeued ?? row;
  }

  private async dropDuplicate(
    row: UploadRow,
    original: UploadRow,
  ): Promise<CompleteUploadResponse> {
    await this.svc.db.delete(uploads).where(eq(uploads.id, row.id));
    await this.storage.delete(row.storageKey).catch(() => undefined);
    return { upload: toUploadDto(original), duplicate: true };
  }
}
