import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  enqueueEvent,
  withTransaction,
  type ObjectStorage,
  type ServiceDb,
} from '@life-island/be-common';
import {
  DOCUMENT_PARSE_FAILED_EVENT,
  DOCUMENT_PARSE_INTERRUPTED_EVENT,
  DOCUMENT_PARSED_EVENT,
  findTarget,
  GENERAL_TARGET_KEY,
  UPLOAD_PARSING_STARTED_EVENT,
  type DocumentParsedV1,
  type DocumentParseFailedV1,
  type DocumentParseInterruptedV1,
  type ParseStep,
  type UploadParsingStartedV1,
} from '@life-island/contracts';
import {
  categorySuggestions,
  documentCategories,
  enqueueUploadUpdated,
  parseRuns,
  uploads,
  type UploadRow,
} from '@life-island/ingestion-db';
import { and, asc, eq } from 'drizzle-orm';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import type pg from 'pg';
import { filterSuggestions } from './category-discovery.js';
import {
  CONFIG,
  PARSER,
  SERVICE_DB,
  STORAGE,
  type WorkerConfig,
} from './config.js';
import { normalizeDocument } from './normalize.js';
import { ParseQueue } from './parse-queue.js';
import {
  ContextTooLargeError,
  CredentialsError,
  PermanentParseError,
  QuotaExhaustedError,
  RateLimitedError,
  type CategoryDefinition,
  type Classification,
  type DocumentAnalyzer,
  type Extraction,
  type ParseInput,
  type ParseRunRecord,
  type ProposedCategory,
} from './parsers/document-parser.js';
import { buildExtractionPlan } from './templates.js';

/** Minutes to wait before attempt n+1: 1, 4, 16, 64... capped at one day. */
export function backoffMinutes(attempts: number): number {
  return Math.min(24 * 60, 4 ** Math.max(0, attempts - 1));
}

export type Outcome =
  'parsed' | 'retried' | 'failed' | 'paused' | 'blocked' | 'lost';
export type RunSummary = Record<Outcome, number>;

/** Another worker took the document over (our lease expired): stop without writing. */
class LeaseLostError extends Error {}

/** The worker's view of a claimed document, updated as steps finish. */
interface Progress {
  upload: UploadRow;
  token: string;
  completed: ParseStep[];
  currentStep: ParseStep | null;
}

/**
 * The parse workflow. Documents are processed one at a time; each goes
 * through CLASSIFY, EXTRACT and DISCOVER, and each step's result is committed
 * with the step's name in `completed_steps` before the next starts. A
 * document picked up again (after a pause, an error or a crash) skips the
 * steps it already has, so no completed AI work is repeated or duplicated.
 */
@Injectable()
export class ParseService {
  private readonly logger = new Logger(ParseService.name);
  readonly queue: ParseQueue;
  private stopRequested = false;

  constructor(
    @Inject(SERVICE_DB) private readonly svc: ServiceDb,
    @Inject(STORAGE) private readonly storage: ObjectStorage,
    @Inject(PARSER) private readonly analyzer: DocumentAnalyzer,
    @Inject(CONFIG) private readonly config: WorkerConfig,
  ) {
    this.queue = new ParseQueue(svc, config);
  }

  /** Finish the current document, then stop (graceful shutdown). */
  requestStop(): void {
    this.stopRequested = true;
  }

  /**
   * Claims the next document: one ready to parse, one whose pause has ended,
   * or one left PARSING by a worker whose lease expired (a crash). Paused and
   * recovered documents go first. `skip locked` keeps two workers off the same
   * row; the fresh `lock_token` makes every later write conditional on still
   * holding it.
   */
  async claimNext(): Promise<UploadRow | undefined> {
    return withTransaction(this.svc.pool, async (client) => {
      const { rows } = await client.query<{ id: string; attempts: number }>(
        `update ingestion.uploads
            set status = 'PARSING',
                locked_until = now() + make_interval(mins => $1),
                lock_token = gen_random_uuid(),
                attempts = attempts + 1,
                last_attempt_at = now(),
                updated_at = now()
          where id = (
            select id from ingestion.uploads
             where (status in ('TO_BE_PARSED', 'PAUSED_QUOTA', 'PAUSED_RATE_LIMIT')
                    and next_attempt_at <= now())
                or (status = 'PARSING' and locked_until < now())
             order by (status <> 'TO_BE_PARSED') desc, created_at
             limit 1
             for update skip locked
          )
          returning id, attempts`,
        [this.config.leaseMinutes],
      );
      const claimed = rows[0];
      if (!claimed) return undefined;
      const event: UploadParsingStartedV1 = {
        uploadId: claimed.id,
        attempt: claimed.attempts,
        startedAt: new Date().toISOString(),
      };
      await enqueueEvent(client, this.svc.schema, {
        type: UPLOAD_PARSING_STARTED_EVENT,
        payload: event,
      });
      const [row] = await drizzle(client)
        .select()
        .from(uploads)
        .where(eq(uploads.id, claimed.id));
      return row;
    });
  }

  /**
   * Processes documents one by one until none are ready, the queue pauses
   * (quota, rate limit, refused credentials) or shutdown is requested. A
   * failing document does not stop the run.
   */
  async runOnce(): Promise<RunSummary> {
    const summary: RunSummary = {
      parsed: 0,
      retried: 0,
      failed: 0,
      paused: 0,
      blocked: 0,
      lost: 0,
    };
    this.stopRequested = false;
    if (!(await this.queue.beginRun())) {
      this.logger.log('The queue is paused; no AI requests until it resumes');
      return summary;
    }
    try {
      while (!this.stopRequested && (await this.queue.canProceed())) {
        const upload = await this.claimNext();
        if (!upload) break;
        const outcome = await this.process(upload);
        summary[outcome]++;
        if (outcome === 'paused' || outcome === 'blocked') break;
      }
    } finally {
      await this.queue.finishRun(summary);
    }
    return summary;
  }

  async process(upload: UploadRow): Promise<Outcome> {
    const progress: Progress = {
      upload,
      token: upload.lockToken!,
      completed: [...upload.completedSteps],
      currentStep: null,
    };
    const heartbeat = setInterval(
      () => void this.extendLease(progress).catch(() => undefined),
      (this.config.leaseMinutes * 60_000) / 3,
    );
    heartbeat.unref();
    try {
      await this.runSteps(progress);
      await this.finish(progress);
      this.logger.log(
        `Parsed ${upload.id}: ${progress.upload.categories.join(', ') || 'no categories'}`,
      );
      return 'parsed';
    } catch (error) {
      return this.handleFailure(progress, error);
    } finally {
      clearInterval(heartbeat);
    }
  }

  private async runSteps(progress: Progress): Promise<void> {
    const { upload } = progress;
    if (!upload.fileFormat)
      throw new PermanentParseError('The upload has no detected format');
    const bytes = await this.storage.getBytes(upload.storageKey);
    const input: ParseInput = {
      document: await normalizeDocument(bytes, upload.fileFormat),
      filename: upload.originalFilename,
      title: upload.title,
      description: upload.description,
    };
    // Read fresh for every document: categories approved during a run apply at once.
    const categories = await this.loadCategories();

    if (!progress.completed.includes('CLASSIFY')) {
      await this.startStep(progress, 'CLASSIFY');
      const output = await this.analyzer.classify(input, categories);
      await this.queue.markHealthy();
      await this.saveClassification(
        progress,
        output.result,
        output.runs,
        categories,
      );
    }
    if (!progress.completed.includes('EXTRACT')) {
      await this.startStep(progress, 'EXTRACT');
      const assigned = categories.filter((category) =>
        progress.upload.categories.includes(category.id),
      );
      const plan = buildExtractionPlan(
        assigned,
        progress.upload.targetKey ?? GENERAL_TARGET_KEY,
      );
      const output = await this.analyzer.extract(input, plan);
      await this.queue.markHealthy();
      await this.saveExtraction(progress, output.result, output.runs);
    }
    if (!progress.completed.includes('DISCOVER')) {
      await this.startStep(progress, 'DISCOVER');
      const context = {
        categories,
        ...(await this.loadSuggestionContext()),
        analysis: progress.upload.analysis!,
        assignedIds: progress.upload.categories,
      };
      const output = await this.analyzer.discover(input, context);
      await this.queue.markHealthy();
      const filtered = filterSuggestions(output.result.suggestions, context);
      for (const drop of filtered.dropped)
        this.logger.debug(`Suggestion ${drop.id} dropped: ${drop.reason}`);
      await this.saveDiscovery(progress, filtered.accepted, output.runs);
    }
  }

  private async loadCategories(): Promise<CategoryDefinition[]> {
    const rows = await this.svc.db
      .select()
      .from(documentCategories)
      .orderBy(asc(documentCategories.id));
    return rows.map((row) => ({
      id: row.id,
      title: row.title,
      description: row.description,
      template: row.templateJson,
    }));
  }

  private async loadSuggestionContext(): Promise<{
    pending: CategoryDefinition[];
    rejectedIds: string[];
  }> {
    const rows = await this.svc.db
      .select()
      .from(categorySuggestions)
      .where(eq(categorySuggestions.status, 'PENDING'));
    const rejected = await this.svc.db
      .selectDistinct({ id: categorySuggestions.categoryId })
      .from(categorySuggestions)
      .where(eq(categorySuggestions.status, 'REJECTED'));
    return {
      pending: rows.map((row) => ({
        id: row.categoryId,
        title: row.title,
        description: row.description,
        template: row.templateJson,
      })),
      rejectedIds: rejected.map((row) => row.id),
    };
  }

  /** Runs `write` and the step's parse runs in one transaction, if we still hold the lease. */
  private async writeStep(
    progress: Progress,
    runs: ParseRunRecord[],
    values: Partial<typeof uploads.$inferInsert>,
    extra?: (client: pg.PoolClient) => Promise<void>,
  ): Promise<void> {
    const saved = await withTransaction(this.svc.pool, async (client) => {
      const db = drizzle(client);
      const [row] = await db
        .update(uploads)
        .set({
          ...values,
          lockedUntil: new Date(Date.now() + this.config.leaseMinutes * 60_000),
          updatedAt: new Date(),
        })
        .where(this.heldBy(progress))
        .returning();
      if (!row) return undefined;
      await this.insertRuns(db, progress.upload.id, runs);
      await extra?.(client);
      return row;
    });
    if (!saved) throw new LeaseLostError();
    progress.upload = saved;
    progress.completed = [...saved.completedSteps];
  }

  private heldBy(progress: Progress) {
    return and(
      eq(uploads.id, progress.upload.id),
      eq(uploads.status, 'PARSING'),
      eq(uploads.lockToken, progress.token),
    );
  }

  private async startStep(progress: Progress, step: ParseStep): Promise<void> {
    progress.currentStep = step;
    await this.writeStep(progress, [], { currentStep: step });
  }

  private withStep(progress: Progress, step: ParseStep): ParseStep[] {
    return [...new Set([...progress.completed, step])];
  }

  private mergeFlags(progress: Progress, flags: string[]): string[] {
    return [...new Set([...progress.upload.flags, ...flags])];
  }

  private async saveClassification(
    progress: Progress,
    result: Classification,
    runs: ParseRunRecord[],
    categories: CategoryDefinition[],
  ): Promise<void> {
    // Only ids that exist: the model cannot assign a category by inventing it.
    const known = new Set(categories.map((category) => category.id));
    const categoryIds = [...new Set(result.categoryIds)].filter((id) =>
      known.has(id),
    );
    await this.writeStep(
      progress,
      runs,
      {
        analysis: {
          ...result.analysis,
          categoryEvidence: result.analysis.categoryEvidence.filter((item) =>
            known.has(item.id),
          ),
        },
        categories: categoryIds,
        targetKey: result.targetKey,
        confidence: result.analysis.confidence,
        flags: this.mergeFlags(progress, result.flags),
        description:
          progress.upload.description ??
          result.description?.slice(0, 255) ??
          null,
        completedSteps: this.withStep(progress, 'CLASSIFY'),
      },
      // The inbox shows the categories as soon as they are known.
      (client) =>
        enqueueUploadUpdated(client, this.svc.schema, [progress.upload.id]),
    );
  }

  private async saveExtraction(
    progress: Progress,
    result: Extraction,
    runs: ParseRunRecord[],
  ): Promise<void> {
    const conflicts = Object.values(result.fields.fields).some(
      (field) =>
        field.status === 'conflicting' ||
        field.status === 'ambiguous' ||
        field.status === 'invalid',
    );
    await this.writeStep(progress, runs, {
      details: result.details,
      extractedFields: result.fields,
      flags: this.mergeFlags(progress, [
        ...result.flags,
        ...(conflicts ? ['needs_attention'] : []),
      ]),
      completedSteps: this.withStep(progress, 'EXTRACT'),
    });
  }

  /**
   * Stores the suggestions with the step, in one transaction. A suggestion
   * already pending under the same id gets this document added to it, so
   * neither a resumed step nor two similar documents create duplicates. With
   * CATEGORY_AUTO_APPROVE the category is saved and assigned at once.
   */
  private async saveDiscovery(
    progress: Progress,
    suggestions: ProposedCategory[],
    runs: ParseRunRecord[],
  ): Promise<void> {
    const uploadId = progress.upload.id;
    const autoApproved: string[] = [];
    await this.writeStep(
      progress,
      runs,
      { completedSteps: this.withStep(progress, 'DISCOVER') },
      async (client) => {
        for (const suggestion of suggestions) {
          if (this.config.autoApproveCategories) {
            const inserted = await client.query(
              `insert into ingestion.document_categories (id, title, description, template_json)
               values ($1, $2, $3, $4)
               on conflict do nothing`,
              [
                suggestion.id,
                suggestion.title,
                suggestion.description,
                JSON.stringify(suggestion.template),
              ],
            );
            if (inserted.rowCount) {
              autoApproved.push(suggestion.id);
              await client.query(
                `insert into ingestion.category_suggestions
                   (category_id, title, description, template_json, reason, status,
                    upload_ids, approved_category_id, reviewed_at)
                 values ($1, $2, $3, $4, $5, 'APPROVED', array[$6]::uuid[], $1, now())`,
                [
                  suggestion.id,
                  suggestion.title,
                  suggestion.description,
                  JSON.stringify(suggestion.template),
                  suggestion.reason,
                  uploadId,
                ],
              );
              continue;
            }
          }
          await client.query(
            `insert into ingestion.category_suggestions
               (category_id, title, description, template_json, reason, upload_ids)
             values ($1, $2, $3, $4, $5, array[$6]::uuid[])
             on conflict (category_id) where status = 'PENDING'
             do update set
               upload_ids = category_suggestions.upload_ids || array(
                 select id from unnest(excluded.upload_ids) as id
                  where id <> all(category_suggestions.upload_ids)),
               updated_at = now()`,
            [
              suggestion.id,
              suggestion.title,
              suggestion.description,
              JSON.stringify(suggestion.template),
              suggestion.reason,
              uploadId,
            ],
          );
        }
        if (autoApproved.length)
          await client.query(
            `update ingestion.uploads
                set categories = categories || array(
                      select id from unnest($2::text[]) as id where id <> all(categories))
              where id = $1`,
            [uploadId, autoApproved],
          );
        await enqueueUploadUpdated(client, this.svc.schema, [uploadId]);
      },
    );
    if (autoApproved.length)
      this.logger.log(`Auto-approved categories: ${autoApproved.join(', ')}`);
  }

  /** Every step is saved: mark the document PARSED and tell the review inbox. */
  private async finish(progress: Progress): Promise<void> {
    await withTransaction(this.svc.pool, async (client) => {
      const [saved] = await drizzle(client)
        .update(uploads)
        .set({
          status: 'PARSED',
          parsedAt: new Date(),
          currentStep: null,
          lockedUntil: null,
          lockToken: null,
          lastError: null,
          updatedAt: new Date(),
        })
        .where(this.heldBy(progress))
        .returning();
      if (!saved) throw new LeaseLostError();
      progress.upload = saved;
      const target =
        findTarget(saved.targetKey ?? '') ?? findTarget(GENERAL_TARGET_KEY)!;
      const event: DocumentParsedV1 = {
        uploadId: saved.id,
        title: saved.title,
        description: saved.description,
        originalFilename: saved.originalFilename,
        fileFormat: saved.fileFormat!,
        sizeBytes: saved.sizeBytes ?? 0,
        uploadedAt: (saved.uploadedAt ?? saved.createdAt).toISOString(),
        category: target.category,
        targetKey: target.targetKey,
        details: saved.details ?? {},
        confidence: saved.confidence ?? 0,
        flags: saved.flags,
        parsedAt: saved.parsedAt!.toISOString(),
      };
      await enqueueEvent(client, this.svc.schema, {
        type: DOCUMENT_PARSED_EVENT,
        payload: event,
      });
    });
  }

  private async handleFailure(
    progress: Progress,
    error: unknown,
  ): Promise<Outcome> {
    if (error instanceof LeaseLostError) {
      this.logger.warn(
        `Lost the lease on ${progress.upload.id}; another worker took it over`,
      );
      return 'lost';
    }
    const message = (
      error instanceof Error ? error.message : String(error)
    ).slice(0, 2000);
    const runs = (error as { runs?: ParseRunRecord[] } | null)?.runs ?? [];
    const id = progress.upload.id;

    if (
      error instanceof QuotaExhaustedError ||
      error instanceof RateLimitedError
    ) {
      const quota = error instanceof QuotaExhaustedError;
      const plan = await this.queue.pause({
        kind: quota ? 'PAUSED_QUOTA' : 'PAUSED_RATE_LIMIT',
        reason: quota
          ? 'The AI provider reports that the usage quota is exhausted'
          : 'The AI provider is rate-limiting requests',
        details: error.details,
        providerResumeAt: quota ? error.resetAt : error.retryAt,
      });
      await this.release(progress, runs, {
        status: quota ? 'PAUSED_QUOTA' : 'PAUSED_RATE_LIMIT',
        nextAttemptAt: plan.resumeAt,
        lastError: message,
        refundAttempt: true,
        interrupted: {
          reason: quota ? 'QUOTA_EXHAUSTED' : 'RATE_LIMITED',
          resumeAt: plan.resumeAt,
        },
      });
      this.logger.warn(
        `${quota ? 'AI usage quota exhausted' : 'Rate-limited'} while on ${progress.currentStep} of ${id}; pausing until ${plan.resumeAt.toISOString()}${plan.reliable ? '' : ' (estimated)'}: ${message}`,
      );
      return 'paused';
    }

    if (error instanceof CredentialsError) {
      await this.queue.blockCredentials(
        'The AI provider refused the API key',
        error.details,
      );
      await this.release(progress, runs, {
        status: 'TO_BE_PARSED',
        nextAttemptAt: new Date(),
        lastError: message,
        refundAttempt: true,
        interrupted: { reason: 'CREDENTIALS', resumeAt: null },
      });
      this.logger.error(`AI credentials refused; stopping the run: ${message}`);
      return 'blocked';
    }

    const permanent =
      error instanceof PermanentParseError ||
      error instanceof ContextTooLargeError;
    const giveUp =
      permanent || progress.upload.attempts >= this.config.maxAttempts;
    if (giveUp) {
      await this.release(progress, runs, {
        status: 'FAILED',
        nextAttemptAt: new Date(),
        lastError: message,
      });
      this.logger.warn(`Parsing ${id} failed for good: ${message}`);
      return 'failed';
    }
    const nextAttemptAt = new Date(
      Date.now() + backoffMinutes(progress.upload.attempts) * 60_000,
    );
    await this.release(progress, runs, {
      status: 'TO_BE_PARSED',
      nextAttemptAt,
      lastError: message,
      interrupted: { reason: 'TRANSIENT_ERROR', resumeAt: nextAttemptAt },
    });
    this.logger.warn(
      `Parsing ${id} failed at ${progress.currentStep ?? 'start'}, will retry after ${nextAttemptAt.toISOString()}: ${message}`,
    );
    return 'retried';
  }

  /**
   * Gives the document back with its saved steps intact. `refundAttempt`
   * undoes the claim's attempt count: a pause is not the document's fault.
   */
  private async release(
    progress: Progress,
    runs: ParseRunRecord[],
    outcome: {
      status: 'TO_BE_PARSED' | 'PAUSED_QUOTA' | 'PAUSED_RATE_LIMIT' | 'FAILED';
      nextAttemptAt: Date;
      lastError: string;
      refundAttempt?: boolean;
      interrupted?: Pick<DocumentParseInterruptedV1, 'reason'> & {
        resumeAt: Date | null;
      };
    },
  ): Promise<void> {
    await withTransaction(this.svc.pool, async (client) => {
      const db = drizzle(client);
      const attempts = Math.max(
        0,
        progress.upload.attempts - (outcome.refundAttempt ? 1 : 0),
      );
      const [saved] = await db
        .update(uploads)
        .set({
          status: outcome.status,
          attempts,
          nextAttemptAt: outcome.nextAttemptAt,
          lastError: outcome.lastError,
          currentStep: progress.currentStep,
          lockedUntil: null,
          lockToken: null,
          updatedAt: new Date(),
        })
        .where(this.heldBy(progress))
        .returning();
      if (!saved) return;
      await this.insertRuns(db, saved.id, runs);
      if (outcome.status === 'FAILED') {
        const event: DocumentParseFailedV1 = {
          uploadId: saved.id,
          error: outcome.lastError,
          attempts: saved.attempts,
          failedAt: new Date().toISOString(),
        };
        await enqueueEvent(client, this.svc.schema, {
          type: DOCUMENT_PARSE_FAILED_EVENT,
          payload: event,
        });
      } else if (outcome.interrupted) {
        const event: DocumentParseInterruptedV1 = {
          uploadId: saved.id,
          reason: outcome.interrupted.reason,
          completedSteps: saved.completedSteps,
          error: outcome.lastError,
          resumeAt: outcome.interrupted.resumeAt?.toISOString() ?? null,
          interruptedAt: new Date().toISOString(),
        };
        await enqueueEvent(client, this.svc.schema, {
          type: DOCUMENT_PARSE_INTERRUPTED_EVENT,
          payload: event,
        });
      }
    });
  }

  private async extendLease(progress: Progress): Promise<void> {
    await this.svc.db
      .update(uploads)
      .set({
        lockedUntil: new Date(Date.now() + this.config.leaseMinutes * 60_000),
      })
      .where(this.heldBy(progress));
  }

  private async insertRuns(
    db: NodePgDatabase,
    uploadId: string,
    runs: ParseRunRecord[],
  ): Promise<void> {
    if (runs.length === 0) return;
    await db.insert(parseRuns).values(
      runs.map((run) => ({
        uploadId,
        step: run.step,
        model: run.model,
        promptVersion: run.promptVersion,
        inputTokens: run.inputTokens,
        outputTokens: run.outputTokens,
        latencyMs: run.latencyMs,
        rawOutput: run.rawOutput,
        error: run.error,
      })),
    );
  }
}
