import type { ServiceDb } from '@life-island/be-common';
import type {
  ParseQueueStatus,
  ProviderErrorDetails,
} from '@life-island/contracts';
import {
  PARSE_QUEUE_ID,
  parseQueue,
  type ParseQueueRow,
} from '@life-island/ingestion-db';
import { and, eq, sql } from 'drizzle-orm';
import type { WorkerConfig } from './config.js';

export type PauseKind = 'PAUSED_QUOTA' | 'PAUSED_RATE_LIMIT';

export interface PauseRequest {
  kind: PauseKind;
  reason: string;
  details: ProviderErrorDetails;
  /** From the provider; null when it gave no time. */
  providerResumeAt: Date | null;
}

/** When a pause should end, and whether that time came from the provider. */
export interface ResumePlan {
  resumeAt: Date;
  reliable: boolean;
}

/**
 * When to try again after a pause. A provider reset time is used as is (plus
 * a minute of margin). Without one, a quota pause waits the configured
 * interval and doubles it after each check that finds the quota still
 * exhausted, so the worker probes rarely rather than polling; a rate limit
 * without retry-after waits a fixed, shorter time.
 */
export function planResume(
  request: Pick<PauseRequest, 'kind' | 'providerResumeAt'>,
  previousAttempts: number,
  config: Pick<
    WorkerConfig,
    'quotaRetryMinutes' | 'quotaRetryMaxMinutes' | 'rateLimitRetrySeconds'
  >,
  now = new Date(),
): ResumePlan {
  if (request.providerResumeAt && request.providerResumeAt > now) {
    const margin = request.kind === 'PAUSED_QUOTA' ? 60_000 : 1_000;
    return {
      resumeAt: new Date(request.providerResumeAt.getTime() + margin),
      reliable: true,
    };
  }
  if (request.kind === 'PAUSED_RATE_LIMIT') {
    return {
      resumeAt: new Date(now.getTime() + config.rateLimitRetrySeconds * 1000),
      reliable: false,
    };
  }
  const minutes = Math.min(
    config.quotaRetryMaxMinutes,
    config.quotaRetryMinutes * 2 ** Math.min(previousAttempts, 16),
  );
  return {
    resumeAt: new Date(now.getTime() + minutes * 60_000),
    reliable: false,
  };
}

const PAUSED: ParseQueueStatus[] = ['PAUSED_QUOTA', 'PAUSED_RATE_LIMIT'];

/**
 * The durable state of the parse queue, one row in `ingestion.parse_queue`.
 * A pause survives restarts, and every worker checks it before claiming a
 * document, so no AI request goes out while the quota is known to be gone.
 */
export class ParseQueue {
  constructor(
    private readonly svc: ServiceDb,
    private readonly config: WorkerConfig,
  ) {}

  async get(): Promise<ParseQueueRow> {
    await this.svc.db
      .insert(parseQueue)
      .values({ id: PARSE_QUEUE_ID })
      .onConflictDoNothing();
    const [row] = await this.svc.db
      .select()
      .from(parseQueue)
      .where(eq(parseQueue.id, PARSE_QUEUE_ID));
    return row;
  }

  /** True when the queue is paused and the pause has not ended yet. */
  isPaused(row: ParseQueueRow, now = new Date()): boolean {
    return PAUSED.includes(row.status) && !!row.resumeAt && row.resumeAt > now;
  }

  /**
   * Starts a run unless a pause is still in force. A pause whose time has come
   * is kept as the status until an AI call succeeds (`markHealthy`), so a
   * quota that is still exhausted extends the pause rather than resetting it.
   * A credentials block is lifted: the key may have been fixed since.
   */
  async beginRun(now = new Date()): Promise<boolean> {
    const row = await this.get();
    if (this.isPaused(row, now)) return false;
    await this.svc.db
      .update(parseQueue)
      .set({
        status: PAUSED.includes(row.status) ? row.status : 'RUNNING',
        runStartedAt: now,
        updatedAt: now,
      })
      .where(eq(parseQueue.id, PARSE_QUEUE_ID));
    return true;
  }

  /** May the worker send AI requests right now? Checked before every document. */
  async canProceed(now = new Date()): Promise<boolean> {
    return !this.isPaused(await this.get(), now);
  }

  /** An AI call went through: whatever pause there was is over. */
  async markHealthy(): Promise<void> {
    await this.svc.db
      .update(parseQueue)
      .set({
        status: 'RUNNING',
        pauseReason: null,
        providerError: null,
        pausedAt: null,
        resumeAt: null,
        resumeAtReliable: false,
        resumeAttempts: 0,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(parseQueue.id, PARSE_QUEUE_ID),
          sql`${parseQueue.status} <> 'RUNNING'`,
        ),
      );
  }

  /** Records a pause and when to try again; returns that plan. */
  async pause(request: PauseRequest, now = new Date()): Promise<ResumePlan> {
    const row = await this.get();
    const sameKind = row.status === request.kind;
    const plan = planResume(
      request,
      sameKind ? row.resumeAttempts : 0,
      this.config,
      now,
    );
    await this.svc.db
      .update(parseQueue)
      .set({
        status: request.kind,
        pauseReason: request.reason,
        providerError: request.details,
        pausedAt: sameKind && row.pausedAt ? row.pausedAt : now,
        resumeAt: plan.resumeAt,
        resumeAtReliable: plan.reliable,
        resumeAttempts: sameKind ? row.resumeAttempts + 1 : 1,
        updatedAt: now,
      })
      .where(eq(parseQueue.id, PARSE_QUEUE_ID));
    return plan;
  }

  /** The API key was refused: stop until the next run (after the key is fixed). */
  async blockCredentials(
    reason: string,
    details: ProviderErrorDetails,
  ): Promise<void> {
    await this.svc.db
      .update(parseQueue)
      .set({
        status: 'BLOCKED_CREDENTIALS',
        pauseReason: reason,
        providerError: details,
        pausedAt: new Date(),
        resumeAt: null,
        resumeAtReliable: false,
        updatedAt: new Date(),
      })
      .where(eq(parseQueue.id, PARSE_QUEUE_ID));
  }

  /** Ends a run: back to IDLE unless it ended in a pause or a block. */
  async finishRun(summary: Record<string, number>): Promise<ParseQueueRow> {
    const now = new Date();
    await this.svc.db
      .update(parseQueue)
      .set({
        status: sql`case when ${parseQueue.status} = 'RUNNING' then 'IDLE'::ingestion.parse_queue_status else ${parseQueue.status} end`,
        runFinishedAt: now,
        lastRunSummary: summary,
        updatedAt: now,
      })
      .where(eq(parseQueue.id, PARSE_QUEUE_ID));
    return this.get();
  }

  async setNextScheduledRun(at: Date | null): Promise<void> {
    await this.get();
    await this.svc.db
      .update(parseQueue)
      .set({ nextScheduledRunAt: at, updatedAt: new Date() })
      .where(eq(parseQueue.id, PARSE_QUEUE_ID));
  }

  /** A run that was RUNNING when the process stopped (crash, kill, deploy). */
  async wasInterrupted(): Promise<boolean> {
    const row = await this.get();
    return (
      row.status === 'RUNNING' ||
      (!!row.runStartedAt &&
        (!row.runFinishedAt || row.runFinishedAt < row.runStartedAt))
    );
  }
}
