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
  createUploadRequestSchema,
  fileFormatFromFilename,
  fileFormatFromMime,
  listUploadsQuerySchema,
  MAX_UPLOAD_BYTES,
  updateUploadRequestSchema,
  UPLOAD_COMPLETED_EVENT,
  type CompleteUploadResponse,
  type CreateUploadResponse,
  type Page,
  type UploadCompletedV1,
  type UploadDto,
} from '@life-island/contracts';
import {
  documentCategories,
  editFieldValues,
  enqueueUploadUpdated,
  FieldEditError,
  syncTemplateFields,
  toUploadDto,
  uploads,
  type UploadRow,
} from '@life-island/ingestion-db';
import {
  and,
  arrayContains,
  count,
  desc,
  eq,
  inArray,
  lt,
  ne,
} from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import type { z } from 'zod';
import {
  CONFIG,
  SERVICE_DB,
  STORAGE,
  type IngestionConfig,
} from '../config.js';
import { inspectFile } from './file-inspection.js';

type CreateUpload = z.output<typeof createUploadRequestSchema>;
type ListUploads = z.output<typeof listUploadsQuerySchema>;
type UpdateUpload = z.output<typeof updateUploadRequestSchema>;

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
    await this.svc.db.insert(uploads).values({
      id,
      title: request.title ?? titleFromFilename(request.filename),
      description: request.description ?? null,
      originalFilename: request.filename,
      declaredMime: request.mimeType,
      sizeBytes: request.sizeBytes,
      storageKey,
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
    if (existing[0]) return this.dropDuplicate(row, existing[0]);

    try {
      const updated = await withTransaction(this.svc.pool, async (client) => {
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
      query.category
        ? arrayContains(uploads.categories, [query.category])
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
    return withTransaction(this.svc.pool, async (client) => {
      const db = drizzle(client);
      const [row] = await db
        .select()
        .from(uploads)
        .where(eq(uploads.id, id))
        .for('update');
      if (!row) throw new NotFoundException(`Upload ${id} not found`);
      if (row.status === 'UPLOADING' || !row.fileFormat)
        throw new ConflictException('This upload has no stored file to edit');
      if (row.status === 'PARSING' && (request.categories || request.fields))
        throw new ConflictException(
          'The AI is processing this document right now; change its categories and fields once it finishes',
        );

      const categoryIds = request.categories
        ? [...new Set(request.categories)]
        : row.categories;
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
      if (request.categories && unknown.length)
        throw new UnprocessableEntityException(
          `Unknown categories: ${unknown.join(', ')}`,
        );
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
      if (request.categories)
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
          ...(request.categories ? { categories: categoryIds } : {}),
          extractedFields,
          updatedAt: new Date(),
        })
        .where(eq(uploads.id, id))
        .returning();
      await enqueueUploadUpdated(client, this.svc.schema, [id]);
      return toUploadDto(saved);
    });
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

  private async dropDuplicate(
    row: UploadRow,
    original: UploadRow,
  ): Promise<CompleteUploadResponse> {
    await this.svc.db.delete(uploads).where(eq(uploads.id, row.id));
    await this.storage.delete(row.storageKey).catch(() => undefined);
    return { upload: toUploadDto(original), duplicate: true };
  }
}
