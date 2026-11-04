import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  withTransaction,
  type ObjectStorage,
  type ServiceDb,
} from '@life-island/be-common';
import {
  CategoryHierarchy,
  type HistoricalSuggestion,
  type ReclassificationTrigger,
} from '@life-island/contracts';
import {
  documentCategories,
  enqueueUploadUpdated,
  expireStaleRuns,
  parseRuns,
  reclassificationRuns,
  resetReclassifying,
  tryStartRun,
  uploads,
  type CategoryRow,
  type ReclassificationRunRow,
  type StartResult,
  type UploadRow,
} from '@life-island/ingestion-db';
import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import type pg from 'pg';
import {
  CONFIG,
  PARSER,
  SERVICE_DB,
  STORAGE,
  type WorkerConfig,
} from '../config.js';
import { normalizeDocument } from '../normalize.js';
import { ParseQueue } from '../parse-queue.js';
import {
  ContextTooLargeError,
  CredentialsError,
  PermanentParseError,
  QuotaExhaustedError,
  RateLimitedError,
  type CategoryDefinition,
  type CategoryMatch,
  type DocumentAnalyzer,
  type ParseRunRecord,
} from '../parsers/document-parser.js';

/** The run no longer holds the lock (its lease expired): stop without writing. */
export class LockLostError extends Error {}

/** Ends the whole run early: the AI quota, refused credentials, shutdown. */
class StopRun extends Error {
  constructor(
    readonly status: 'INTERRUPTED' | 'FAILED',
    message: string,
  ) {
    super(message);
  }
}

export interface ReclassificationSummary {
  /** Documents eligible when the run started. */
  eligible: number;
  /** Documents looked at so far. */
  checked: number;
  /** No newer category could apply: marked checked without an AI call. */
  noCandidates: number;
  /** Checked by the AI, nothing found: marked checked. */
  unchanged: number;
  /** Newer categories found: waiting for your review. */
  suggested: number;
  /** Left as they were (unreadable, repeated errors); still eligible next time. */
  failed: number;
}

/** The category facts the eligibility rules need, beyond what the analyzer sees. */
interface Candidate extends CategoryDefinition {
  taxonomyVersion: number;
}

const RETRY_DELAYS_MS = [2_000, 8_000];
/** A rate limit longer than this ends the run instead of holding the lock. */
const MAX_RATE_LIMIT_WAIT_MS = 2 * 60_000;

/**
 * The confirmed categories that may be proposed for one document: confirmed
 * after its last check (and not after the run's target), not already on it
 * nor implied by it (an ancestor of one it has), not suggested for it by the
 * parser, and never declined for it.
 */
export function candidatesFor(
  upload: Pick<
    UploadRow,
    | 'categories'
    | 'rejectedCategories'
    | 'historicalReviewedVersion'
    | 'classifiedCategoryVersion'
  >,
  categories: readonly Candidate[],
  targetVersion: number,
  pendingSuggested: ReadonlySet<string> = new Set(),
): Candidate[] {
  const baseline = Math.max(
    upload.historicalReviewedVersion ?? 0,
    upload.classifiedCategoryVersion ?? 0,
  );
  const tree = new CategoryHierarchy(
    categories.map((category) => ({
      id: category.id,
      parentId: category.parentId ?? null,
    })),
  );
  const implied = new Set(
    upload.categories.flatMap((id) => [
      id,
      ...tree.ancestors(id).map((ancestor) => ancestor.id),
    ]),
  );
  const rejected = new Set(upload.rejectedCategories);
  return categories.filter(
    (category) =>
      category.taxonomyVersion > baseline &&
      category.taxonomyVersion <= targetVersion &&
      !implied.has(category.id) &&
      !pendingSuggested.has(category.id) &&
      !rejected.has(category.id),
  );
}

/**
 * Historical reclassification: documents parsed in the past are checked
 * against the categories confirmed since, and what applies is stored as
 * separate findings for you to review. It never changes a document's
 * categories, the parser's suggestions or its normal status.
 *
 * Separate from the initial parsing in everything but the shared tools (the
 * analyzer, storage, the AI pause): its own run table, lock, states and
 * schedule. While a run is alive it holds the global lock, renewing its
 * lease; every result is committed before the document counts as checked,
 * so a crash or a retry never duplicates or loses one.
 */
@Injectable()
export class ReclassificationService {
  private readonly logger = new Logger(ReclassificationService.name);
  private readonly queue: ParseQueue;
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

  /** The monthly schedule's start: the same checks and lock as Reclassify now. */
  start(trigger: ReclassificationTrigger): Promise<StartResult> {
    return tryStartRun(
      this.svc.pool,
      trigger,
      this.config.reclassifyLeaseMinutes,
      this.svc.schema,
    );
  }

  /** Ends runs whose lease expired (a crash) and frees their documents. */
  async recoverStale(): Promise<number> {
    return withTransaction(this.svc.pool, (client) =>
      expireStaleRuns(client, this.svc.schema),
    );
  }

  /** The RUNNING run with a live lease that nobody in this process works on yet. */
  async runningRun(): Promise<ReclassificationRunRow | undefined> {
    const [row] = await this.svc.db
      .select()
      .from(reclassificationRuns)
      .where(eq(reclassificationRuns.status, 'RUNNING'));
    return row && row.leaseUntil && row.leaseUntil > new Date()
      ? row
      : undefined;
  }

  /**
   * Works through every eligible document in batches, then releases the
   * lock. The run must be RUNNING (started by `tryStartRun`).
   */
  async run(run: ReclassificationRunRow): Promise<ReclassificationSummary> {
    this.stopRequested = false;
    const target = run.targetVersion ?? 0;
    const summary: ReclassificationSummary = {
      eligible: 0,
      checked: 0,
      noCandidates: 0,
      unchanged: 0,
      suggested: 0,
      failed: 0,
    };
    let lost = false;
    const heartbeat = setInterval(
      () =>
        void this.renewLease(run.id)
          .then((held) => {
            if (!held) lost = true;
          })
          .catch(() => undefined),
      (this.config.reclassifyLeaseMinutes * 60_000) / 3,
    );
    heartbeat.unref();
    let outcome: {
      status: 'COMPLETED' | 'INTERRUPTED' | 'FAILED';
      error?: string;
    } = {
      status: 'COMPLETED',
    };
    try {
      // Leftovers of a run that crashed: nothing of theirs was saved.
      await withTransaction(this.svc.pool, (client) =>
        resetReclassifying(client, 'any', this.svc.schema),
      );
      summary.eligible = await this.countEligible(target);
      await this.saveSummary(run.id, summary);
      // The taxonomy cannot change while the lock is held: read it once.
      const categories = await this.loadCandidates();
      const pending = await this.pendingSuggestionsByUpload();
      this.logger.log(
        `Reclassification ${run.id}: ${summary.eligible} document(s) to check against taxonomy version ${target}`,
      );
      let after = '00000000-0000-0000-0000-000000000000';
      for (;;) {
        if (lost) throw new LockLostError();
        if (this.stopRequested)
          throw new StopRun(
            'INTERRUPTED',
            'The processing service was stopped; the next run continues where this one stopped',
          );
        const batch = await this.nextBatch(target, after);
        if (!batch.length) break;
        for (const upload of batch) {
          if (lost) throw new LockLostError();
          if (this.stopRequested) break;
          after = upload.id;
          await this.processDocument(
            run.id,
            upload,
            categories,
            target,
            pending.get(upload.id) ?? new Set(),
            summary,
          );
          summary.checked++;
        }
        await this.saveSummary(run.id, summary);
      }
    } catch (error) {
      if (error instanceof LockLostError) {
        this.logger.error(
          `Reclassification ${run.id} lost its lock (lease expired); stopping without writing`,
        );
        outcome = {
          status: 'INTERRUPTED',
          error:
            'The run lost its lock; the next run continues where it stopped',
        };
      } else if (error instanceof StopRun) {
        outcome = { status: error.status, error: error.message };
      } else {
        this.logger.error(
          `Reclassification ${run.id} failed: ${String(error)}`,
        );
        outcome = {
          status: 'FAILED',
          error: (error instanceof Error ? error.message : String(error)).slice(
            0,
            2000,
          ),
        };
      }
    } finally {
      clearInterval(heartbeat);
      await this.finish(run.id, summary, outcome).catch((error: unknown) =>
        this.logger.error(`Could not close run ${run.id}: ${String(error)}`),
      );
    }
    this.logger.log(
      `Reclassification ${run.id} ${outcome.status.toLowerCase()}: ${JSON.stringify(summary)}`,
    );
    return summary;
  }

  // ---- one document ---------------------------------------------------------

  private async processDocument(
    runId: string,
    upload: UploadRow,
    categories: Candidate[],
    target: number,
    pendingSuggested: Set<string>,
    summary: ReclassificationSummary,
  ): Promise<void> {
    const candidates = candidatesFor(
      upload,
      categories,
      target,
      pendingSuggested,
    );
    if (!candidates.length) {
      // Nothing newer could apply: checked, without asking the AI.
      await this.persist(runId, upload.id, target, null, []);
      summary.noCandidates++;
      return;
    }
    await this.markReclassifying(runId, upload.id);
    try {
      const { matches, runs } = await this.match(
        upload,
        candidates,
        categories,
      );
      await this.persist(runId, upload.id, target, matches, runs);
      if (matches.length) summary.suggested++;
      else summary.unchanged++;
    } catch (error) {
      const runs = (error as { runs?: ParseRunRecord[] } | null)?.runs ?? [];
      if (error instanceof LockLostError) throw error;
      await this.release(runId, upload.id, runs);
      if (error instanceof QuotaExhaustedError) {
        const plan = await this.queue.pause({
          kind: 'PAUSED_QUOTA',
          reason: 'The AI provider reports that the usage quota is exhausted',
          details: error.details,
          providerResumeAt: error.resetAt,
        });
        throw new StopRun(
          'INTERRUPTED',
          `The AI usage quota is exhausted (until ${plan.resumeAt.toISOString()}); the next run continues where this one stopped`,
        );
      }
      if (error instanceof RateLimitedError) {
        await this.queue.pause({
          kind: 'PAUSED_RATE_LIMIT',
          reason: 'The AI provider is rate-limiting requests',
          details: error.details,
          providerResumeAt: error.retryAt,
        });
        throw new StopRun(
          'INTERRUPTED',
          'The AI provider kept rate-limiting requests; the next run continues where this one stopped',
        );
      }
      if (error instanceof CredentialsError) {
        await this.queue.blockCredentials(
          'The AI provider refused the API key',
          error.details,
        );
        throw new StopRun('FAILED', 'The AI provider refused the API key');
      }
      this.logger.warn(
        `Could not reclassify ${upload.id}; it stays eligible: ${String(error)}`,
      );
      summary.failed++;
    }
  }

  /** The AI call, with a couple of retries for passing errors and short rate limits. */
  private async match(
    upload: UploadRow,
    candidates: Candidate[],
    categories: Candidate[],
  ): Promise<{ matches: CategoryMatch[]; runs: ParseRunRecord[] }> {
    if (!upload.fileFormat)
      throw new PermanentParseError('The upload has no detected format');
    const runs: ParseRunRecord[] = [];
    for (let attempt = 0; ; attempt++) {
      try {
        const bytes = await this.storage.getBytes(upload.storageKey);
        const output = await this.analyzer.matchCategories(
          {
            document: await normalizeDocument(bytes, upload.fileFormat),
            filename: upload.originalFilename,
            title: upload.title,
            description: upload.description,
          },
          candidates,
          {
            analysis: upload.analysis,
            assigned: categories.filter((category) =>
              upload.categories.includes(category.id),
            ),
          },
        );
        await this.queue.markHealthy();
        runs.push(...output.runs);
        const allowed = new Set(candidates.map((category) => category.id));
        return {
          matches: output.result.matches.filter((match) =>
            allowed.has(match.categoryId),
          ),
          runs,
        };
      } catch (error) {
        runs.push(
          ...((error as { runs?: ParseRunRecord[] } | null)?.runs ?? []),
        );
        const permanent =
          error instanceof PermanentParseError ||
          error instanceof ContextTooLargeError ||
          error instanceof QuotaExhaustedError ||
          error instanceof CredentialsError;
        const wait =
          error instanceof RateLimitedError
            ? Math.max(
                1000,
                (error.retryAt?.getTime() ?? Date.now() + 60_000) - Date.now(),
              )
            : RETRY_DELAYS_MS[attempt];
        const retry =
          !permanent &&
          attempt < RETRY_DELAYS_MS.length &&
          !this.stopRequested &&
          (!(error instanceof RateLimitedError) ||
            wait <= MAX_RATE_LIMIT_WAIT_MS);
        if (!retry) throw Object.assign(error as object, { runs });
        await new Promise((resolve) => setTimeout(resolve, wait));
      }
    }
  }

  // ---- persistence ------------------------------------------------------------

  /** Runs `write` only while this run still holds a live lock. */
  private async whileLocked<T>(
    runId: string,
    write: (client: pg.PoolClient) => Promise<T>,
  ): Promise<T> {
    return withTransaction(this.svc.pool, async (client) => {
      const { rowCount } = await client.query(
        `select 1 from ingestion.reclassification_runs
          where id = $1 and status = 'RUNNING' and lease_until > now()
          for share`,
        [runId],
      );
      if (!rowCount) throw new LockLostError();
      return write(client);
    });
  }

  private async markReclassifying(
    runId: string,
    uploadId: string,
  ): Promise<void> {
    await this.whileLocked(runId, async (client) => {
      await drizzle(client)
        .update(uploads)
        .set({
          historicalStatus: 'RECLASSIFYING',
          historicalRunId: runId,
          updatedAt: new Date(),
        })
        .where(and(eq(uploads.id, uploadId), isNull(uploads.historicalStatus)));
      await enqueueUploadUpdated(client, this.svc.schema, [uploadId]);
    });
  }

  /**
   * Saves one document's result in one transaction. Findings: PENDING_REVIEW,
   * checked against `target` only once you decide. None (or no candidates):
   * back to normal and checked against `target` now.
   */
  private async persist(
    runId: string,
    uploadId: string,
    target: number,
    matches: CategoryMatch[] | null,
    runs: ParseRunRecord[],
  ): Promise<void> {
    await this.whileLocked(runId, async (client) => {
      const db = drizzle(client);
      const found: HistoricalSuggestion[] = (matches ?? []).map((match) => ({
        categoryId: match.categoryId,
        evidence: match.evidence,
        confidence: match.confidence,
      }));
      const [saved] = await db
        .update(uploads)
        .set(
          found.length
            ? {
                historicalStatus: 'PENDING_REVIEW',
                historicalSuggestions: found,
                historicalProcessingVersion: target,
                historicalRunId: runId,
                updatedAt: new Date(),
              }
            : {
                historicalStatus: null,
                historicalSuggestions: [],
                historicalReviewedVersion: target,
                historicalProcessingVersion: null,
                historicalRunId: null,
                ...(matches ? { updatedAt: new Date() } : {}),
              },
        )
        .where(
          and(
            eq(uploads.id, uploadId),
            eq(uploads.status, 'PARSED'),
            sql`(${uploads.historicalStatus} is null or ${uploads.historicalRunId} = ${runId})`,
          ),
        )
        .returning({ id: uploads.id });
      if (!saved) return;
      if (runs.length)
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
      // The inbox shows the overlay; a document that never left normal needs no event.
      if (matches)
        await enqueueUploadUpdated(client, this.svc.schema, [uploadId]);
    });
  }

  /** Back to normal without counting as checked: it stays eligible for the next run. */
  private async release(
    runId: string,
    uploadId: string,
    runs: ParseRunRecord[],
  ): Promise<void> {
    await this.whileLocked(runId, async (client) => {
      const db = drizzle(client);
      await db
        .update(uploads)
        .set({
          historicalStatus: null,
          historicalRunId: null,
          updatedAt: new Date(),
        })
        .where(
          and(eq(uploads.id, uploadId), eq(uploads.historicalRunId, runId)),
        );
      if (runs.length)
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
      await enqueueUploadUpdated(client, this.svc.schema, [uploadId]);
    }).catch((error: unknown) => {
      if (error instanceof LockLostError) throw error;
      this.logger.warn(`Could not release ${uploadId}: ${String(error)}`);
    });
  }

  private async renewLease(runId: string): Promise<boolean> {
    const { rowCount } = await this.svc.pool.query(
      `update ingestion.reclassification_runs
          set lease_until = now() + make_interval(mins => $2)
        where id = $1 and status = 'RUNNING' and lease_until > now()`,
      [runId, this.config.reclassifyLeaseMinutes],
    );
    return !!rowCount;
  }

  private async saveSummary(
    runId: string,
    summary: ReclassificationSummary,
  ): Promise<void> {
    await this.svc.db
      .update(reclassificationRuns)
      .set({ summary: { ...summary } })
      .where(eq(reclassificationRuns.id, runId));
  }

  /** Releases the lock: the final status, in one write. */
  private async finish(
    runId: string,
    summary: ReclassificationSummary,
    outcome: { status: 'COMPLETED' | 'INTERRUPTED' | 'FAILED'; error?: string },
  ): Promise<void> {
    await withTransaction(this.svc.pool, async (client) => {
      await drizzle(client)
        .update(reclassificationRuns)
        .set({
          status: outcome.status,
          summary: { ...summary },
          lastError: outcome.error ?? null,
          finishedAt: new Date(),
          leaseUntil: null,
        })
        .where(
          and(
            eq(reclassificationRuns.id, runId),
            eq(reclassificationRuns.status, 'RUNNING'),
          ),
        );
      // Anything this run left mid-way goes back to normal.
      await resetReclassifying(client, [runId], this.svc.schema);
    });
  }

  // ---- reading ---------------------------------------------------------------

  private eligibleWhere(target: number) {
    return sql`${uploads.status} = 'PARSED'
      and ${uploads.historicalStatus} is null
      and greatest(coalesce(${uploads.historicalReviewedVersion}, 0),
                   coalesce(${uploads.classifiedCategoryVersion}, 0)) < ${target}`;
  }

  private async countEligible(target: number): Promise<number> {
    const [row] = await this.svc.db
      .select({ count: sql<number>`count(*)::int` })
      .from(uploads)
      .where(this.eligibleWhere(target));
    return row?.count ?? 0;
  }

  /** The next eligible documents by id: never the whole collection in memory. */
  private async nextBatch(target: number, after: string): Promise<UploadRow[]> {
    return this.svc.db
      .select()
      .from(uploads)
      .where(
        sql`${this.eligibleWhere(target)} and ${uploads.id} > ${after}::uuid`,
      )
      .orderBy(asc(uploads.id))
      .limit(this.config.reclassifyBatchSize);
  }

  private async loadCandidates(): Promise<Candidate[]> {
    const rows: CategoryRow[] = await this.svc.db
      .select()
      .from(documentCategories)
      .orderBy(asc(documentCategories.id));
    return rows.map((row) => ({
      id: row.id,
      title: row.title,
      description: row.description,
      template: row.templateJson,
      parentId: row.parentId,
      dimension: row.dimension,
      taxonomyVersion: row.taxonomyVersion,
    }));
  }

  /** Category ids the parser suggested for each document, still pending. */
  private async pendingSuggestionsByUpload(): Promise<
    Map<string, Set<string>>
  > {
    const { rows } = await this.svc.pool.query<{
      upload_id: string;
      category_id: string;
    }>(
      `select unnest(upload_ids) as upload_id, category_id
         from ingestion.category_suggestions where status = 'PENDING'`,
    );
    const map = new Map<string, Set<string>>();
    for (const row of rows) {
      const ids = map.get(row.upload_id) ?? new Set<string>();
      ids.add(row.category_id);
      map.set(row.upload_id, ids);
    }
    return map;
  }
}
