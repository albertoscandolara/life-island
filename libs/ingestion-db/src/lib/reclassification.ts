import type {
  ReclassificationBlock,
  ReclassificationRunDto,
  ReclassificationStateDto,
  ReclassificationTrigger,
} from '@life-island/contracts';
import { RECLASSIFICATION_LOCKED_CODE } from '@life-island/contracts';
import { drizzle } from 'drizzle-orm/node-postgres';
import { desc, eq, ne } from 'drizzle-orm';
import type pg from 'pg';
import {
  reclassificationRuns,
  taxonomyState,
  type ReclassificationRunRow,
} from './schema.js';
import { enqueueUploadUpdated } from './upload-events.js';

/**
 * Taxonomy versioning and the global lock of historical reclassification,
 * shared by svc-ingestion (API, every write) and svc-parse-worker (the
 * parser and the reclassification run), so both apply exactly the same rules.
 */

export const TAXONOMY_STATE_ID = 'global';

/** NOTIFY channel that wakes the worker for Reclassify now. */
export const RECLASSIFY_CHANNEL = 'reclassify_requested';

/**
 * Advisory lock key. Every write that could touch documents or the taxonomy
 * takes it shared inside its transaction and checks for a running
 * reclassification; starting a run (or a parse run) takes it exclusive. So a
 * write already in flight commits before a run starts, and none can commit
 * after.
 */
const LOCK_KEY = 'ingestion:reclassification';

export async function lockShared(client: pg.ClientBase): Promise<void> {
  await client.query('select pg_advisory_xact_lock_shared(hashtext($1))', [
    LOCK_KEY,
  ]);
}

export async function lockExclusive(client: pg.ClientBase): Promise<void> {
  await client.query('select pg_advisory_xact_lock(hashtext($1))', [LOCK_KEY]);
}

/** The taxonomy version now (0 before any category was confirmed). */
export async function currentTaxonomyVersion(
  client: pg.ClientBase,
): Promise<number> {
  const { rows } = await client.query<{ version: number }>(
    `select version from ingestion.taxonomy_state where id = $1`,
    [TAXONOMY_STATE_ID],
  );
  return rows[0]?.version ?? 0;
}

/**
 * One confirming operation, one new version, however many categories it
 * confirms. Call it once, in the transaction that creates them, and write the
 * returned number on each. The row lock serializes concurrent confirmations;
 * a rollback undoes the bump with everything else.
 */
export async function bumpTaxonomyVersion(
  client: pg.ClientBase,
): Promise<number> {
  const { rows } = await client.query<{ version: number }>(
    `insert into ingestion.taxonomy_state (id, version) values ($1, 1)
     on conflict (id) do update
       set version = ingestion.taxonomy_state.version + 1, updated_at = now()
     returning version`,
    [TAXONOMY_STATE_ID],
  );
  return rows[0].version;
}

/** Thrown by a write while a reclassification run holds the lock (HTTP 423). */
export class ReclassificationLockedError extends Error {
  readonly code = RECLASSIFICATION_LOCKED_CODE;
  constructor(
    readonly runId: string,
    readonly startedAt: Date | null,
  ) {
    super(
      'Past documents are being checked against new categories. Uploads, parsing and changes to documents and categories are paused until it finishes.',
    );
    this.name = 'ReclassificationLockedError';
  }
}

/** The run holding the lock: RUNNING with a lease that has not expired. */
export async function activeRun(
  client: pg.PoolClient,
): Promise<ReclassificationRunRow | undefined> {
  const [row] = await drizzle(client)
    .select()
    .from(reclassificationRuns)
    .where(eq(reclassificationRuns.status, 'RUNNING'));
  return row && row.leaseUntil && row.leaseUntil > new Date() ? row : undefined;
}

/**
 * The write guard: call it first in every transaction that changes documents
 * or the taxonomy. Throws while a reclassification holds the lock.
 */
export async function assertWritable(client: pg.PoolClient): Promise<void> {
  await lockShared(client);
  const run = await activeRun(client);
  if (run) throw new ReclassificationLockedError(run.id, run.startedAt);
}

/**
 * Ends runs whose worker stopped renewing the lease (crash, kill): they become
 * INTERRUPTED and their documents still marked RECLASSIFYING go back to
 * normal (nothing of theirs was saved, so the next run redoes them). Returns
 * how many runs it ended.
 */
export async function expireStaleRuns(
  client: pg.ClientBase,
  schema = 'ingestion',
): Promise<number> {
  const { rows } = await client.query<{ id: string }>(
    `update ingestion.reclassification_runs
        set status = 'INTERRUPTED', finished_at = now(), lease_until = null,
            last_error = coalesce(last_error, 'The processing service stopped before the run finished; the next run continues where it stopped')
      where status = 'RUNNING' and (lease_until is null or lease_until <= now())
      returning id`,
  );
  if (!rows.length) return 0;
  await resetReclassifying(
    client,
    rows.map((row) => row.id),
    schema,
  );
  return rows.length;
}

/** Documents a run marked RECLASSIFYING go back to normal (their results were never saved). */
export async function resetReclassifying(
  client: pg.ClientBase,
  runIds: string[] | 'any',
  schema = 'ingestion',
): Promise<number> {
  const { rows } = await client.query<{ id: string }>(
    `update ingestion.uploads
        set historical_status = null, historical_run_id = null, updated_at = now()
      where historical_status = 'RECLASSIFYING'
        and ($1::uuid[] is null or historical_run_id = any($1::uuid[]) or historical_run_id is null)
      returning id`,
    [runIds === 'any' ? null : runIds],
  );
  await enqueueUploadUpdated(
    client,
    schema,
    rows.map((row) => row.id),
  );
  return rows.length;
}

const BLOCK_MESSAGES = {
  PENDING_SUGGESTIONS: (count: number) =>
    `${count} suggested categor${count === 1 ? 'y waits' : 'ies wait'} for a decision on the Categories page`,
  PARSING_RUNNING: () => 'New documents are being parsed right now',
  ALREADY_RUNNING: () => 'A reclassification is already running',
  AI_PAUSED: () =>
    'AI processing is paused (usage quota or rate limit); it resumes by itself',
};

/**
 * Why a run cannot start now; empty when it can. The prerequisites: no
 * suggested category waiting, the initial parser idle, no other run, and the
 * AI not paused.
 */
export async function startBlocks(
  client: pg.ClientBase,
): Promise<ReclassificationBlock[]> {
  const { rows } = await client.query<{
    pending: number;
    parsing: boolean;
    paused: boolean;
    running: boolean;
  }>(
    `select
       (select count(*)::int from ingestion.category_suggestions where status = 'PENDING') as pending,
       (exists (select 1 from ingestion.parse_queue where status = 'RUNNING')
        or exists (select 1 from ingestion.uploads
                    where status = 'PARSING' and locked_until > now())) as parsing,
       exists (select 1 from ingestion.parse_queue
                where status in ('PAUSED_QUOTA', 'PAUSED_RATE_LIMIT')
                  and resume_at > now()) as paused,
       exists (select 1 from ingestion.reclassification_runs
                where status = 'RUNNING' and lease_until > now()) as running`,
  );
  const state = rows[0];
  const blocks: ReclassificationBlock[] = [];
  if (state.running)
    blocks.push({
      code: 'ALREADY_RUNNING',
      message: BLOCK_MESSAGES.ALREADY_RUNNING(),
    });
  if (state.pending > 0)
    blocks.push({
      code: 'PENDING_SUGGESTIONS',
      message: BLOCK_MESSAGES.PENDING_SUGGESTIONS(state.pending),
    });
  if (state.parsing)
    blocks.push({
      code: 'PARSING_RUNNING',
      message: BLOCK_MESSAGES.PARSING_RUNNING(),
    });
  if (state.paused)
    blocks.push({ code: 'AI_PAUSED', message: BLOCK_MESSAGES.AI_PAUSED() });
  return blocks;
}

export type StartResult =
  | { started: true; run: ReclassificationRunRow }
  | {
      started: false;
      /** The BLOCKED run recorded for a scheduled attempt; none for a manual one. */
      run: ReclassificationRunRow | null;
      reasons: ReclassificationBlock[];
    };

/**
 * Starts a reclassification, the same way for Reclassify now and for the
 * monthly schedule: in one transaction, under the exclusive lock, it ends
 * stale runs, checks every prerequisite and either refuses with the reasons
 * (a scheduled attempt also records a BLOCKED run; no document is touched)
 * or creates the RUNNING run that
 * is the lock, with the taxonomy version to check against and a lease.
 */
export async function tryStartRun(
  pool: pg.Pool,
  trigger: ReclassificationTrigger,
  leaseMinutes: number,
  schema = 'ingestion',
): Promise<StartResult> {
  const client = await pool.connect();
  try {
    await client.query('begin');
    await lockExclusive(client);
    await expireStaleRuns(client, schema);
    const reasons = await startBlocks(client);
    const db = drizzle(client);
    let result: StartResult;
    if (reasons.length) {
      // A scheduled attempt leaves a trace for the status line; a manual one
      // gets the reasons in its answer instead.
      const [run] =
        trigger === 'SCHEDULED'
          ? await db
              .insert(reclassificationRuns)
              .values({
                trigger,
                status: 'BLOCKED',
                blockedReasons: reasons,
                finishedAt: new Date(),
              })
              .returning()
          : [null];
      result = { started: false, run, reasons };
    } else {
      const targetVersion = await currentTaxonomyVersion(client);
      const { rows } = await client.query<{ id: string }>(
        `insert into ingestion.reclassification_runs
           (trigger, status, target_version, lease_until, started_at)
         values ($1, 'RUNNING', $2, now() + make_interval(mins => $3), now())
         returning id`,
        [trigger, targetVersion, leaseMinutes],
      );
      const [run] = await db
        .select()
        .from(reclassificationRuns)
        .where(eq(reclassificationRuns.id, rows[0].id));
      await client.query(`select pg_notify($1, $2)`, [
        RECLASSIFY_CHANNEL,
        run.id,
      ]);
      result = { started: true, run };
    }
    await client.query('commit');
    return result;
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }
}

export function toReclassificationRunDto(
  row: ReclassificationRunRow,
): ReclassificationRunDto {
  return {
    id: row.id,
    trigger: row.trigger,
    status: row.status,
    targetVersion: row.targetVersion,
    blockedReasons: row.blockedReasons,
    requestedAt: row.requestedAt.toISOString(),
    startedAt: row.startedAt?.toISOString() ?? null,
    finishedAt: row.finishedAt?.toISOString() ?? null,
    summary: row.summary,
    lastError: row.lastError,
  };
}

/** Everything the documents app shows about reclassification. */
export async function reclassificationState(
  client: pg.PoolClient,
): Promise<ReclassificationStateDto> {
  const db = drizzle(client);
  const current = await activeRun(client);
  const [last] = await db
    .select()
    .from(reclassificationRuns)
    .where(ne(reclassificationRuns.status, 'RUNNING'))
    .orderBy(desc(reclassificationRuns.requestedAt))
    .limit(1);
  const [taxonomy] = await db
    .select()
    .from(taxonomyState)
    .where(eq(taxonomyState.id, TAXONOMY_STATE_ID));
  const blocks = await startBlocks(client);
  const { rows } = await client.query<{ pending: number }>(
    `select count(*)::int as pending from ingestion.uploads
      where historical_status = 'PENDING_REVIEW'`,
  );
  return {
    locked: !!current,
    taxonomyVersion: taxonomy?.version ?? 0,
    currentRun: current ? toReclassificationRunDto(current) : null,
    lastRun: last ? toReclassificationRunDto(last) : null,
    canStart: blocks.length === 0,
    blockedReasons: blocks,
    pendingReview: rows[0]?.pending ?? 0,
    nextScheduledRunAt: taxonomy?.nextReclassificationAt?.toISOString() ?? null,
  };
}
