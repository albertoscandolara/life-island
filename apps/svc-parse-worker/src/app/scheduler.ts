import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { readSettings, type ServiceDb } from '@life-island/be-common';
import {
  READ_ON_START_SETTING,
  READING_TIME_SETTING,
  SCHEDULED_READING_SETTING,
  validSettingValue,
} from '@life-island/contracts';
import { Cron } from 'croner';
import type pg from 'pg';
import { PARSE_QUEUE_ID } from '@life-island/ingestion-db';
import {
  CONFIG,
  scheduleToCron,
  SERVICE_DB,
  type WorkerConfig,
} from './config.js';
import { ParseService } from './parse.service.js';

/**
 * How often the worker also looks for a Parse now request in the database, in
 * case its NOTIFY was lost (a listener connection that died without an error).
 */
export const REQUEST_POLL_MS = 15_000;

/** Parse now was pressed after the last run started. */
function requestedSinceLastRun(queue: {
  runRequestedAt: Date | null;
  runStartedAt: Date | null;
}): boolean {
  return (
    !!queue.runRequestedAt &&
    (!queue.runStartedAt || queue.runRequestedAt > queue.runStartedAt)
  );
}

/** The daily reading as Settings has it, else as .env has it. */
export interface ReadingSchedule {
  /** null: no daily run (Settings → Documents → Read documents every day is off). */
  cron: string | null;
  runOnStart: boolean;
}

/**
 * Settings (documents.scheduled-reading, documents.reading-time,
 * documents.read-on-start) win over PARSE_SCHEDULE and PARSE_RUN_ON_START
 * once you set them; a value Settings never set leaves the .env one.
 */
export function readingSchedule(
  config: Pick<WorkerConfig, 'schedule' | 'runOnStart'>,
  stored: ReadonlyMap<string, unknown>,
): ReadingSchedule {
  const value = (key: string) => {
    const v = stored.get(key);
    return validSettingValue(key, v) ? v : undefined;
  };
  const daily = value(SCHEDULED_READING_SETTING);
  const time = value(READING_TIME_SETTING);
  const onStart = value(READ_ON_START_SETTING);
  return {
    cron:
      daily === false
        ? null
        : typeof time === 'string'
          ? scheduleToCron(time)
          : config.schedule,
    runOnStart: typeof onStart === 'boolean' ? onStart : config.runOnStart,
  };
}

/** setTimeout cannot wait longer than ~24.8 days; longer waits re-check on wake. */
const MAX_TIMER_MS = 2 ** 31 - 1;

/**
 * Runs the parser every day at the configured time (PARSE_SCHEDULE, 06:00 by
 * default) and, independently of that schedule, whenever work becomes due:
 * a pause that ends (quota back, rate limit over), a document whose retry
 * delay has passed, or a document left behind by a worker that crashed. Every
 * one of those times is read from the database, so a restart picks them up.
 */
@Injectable()
export class ParseScheduler
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private readonly logger = new Logger(ParseScheduler.name);
  private job?: Cron;
  private current?: Promise<void>;
  private wakeTimer?: NodeJS.Timeout;
  private stopping = false;
  /** A Parse now request arrived during a run: run again right after it. */
  private rerun = false;
  private listener?: pg.PoolClient;
  private listenRetry?: NodeJS.Timeout;
  private requestPoll?: NodeJS.Timeout;
  /** How often to look for a missed Parse now request (tests shorten it). */
  pollMs = REQUEST_POLL_MS;
  /** The daily schedule running now; undefined before the first read. */
  private cron?: string | null;

  constructor(
    @Inject(ParseService) private readonly parse: ParseService,
    @Inject(CONFIG) private readonly config: WorkerConfig,
    @Inject(SERVICE_DB) private readonly svc: ServiceDb,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    const schedule = await this.readSchedule();
    await this.applySchedule(schedule.cron);
    await this.listen();
    await this.beat();
    this.pollRequests();
    if (schedule.runOnStart) void this.trigger('startup');
    else if (await this.parse.queue.wasInterrupted())
      void this.trigger('recovery after restart');
    else if (await this.runRequestedSinceLastRun())
      void this.trigger('parse now (requested while stopped)');
    else await this.scheduleWake();
  }

  /** The schedule from this worker's settings replica; .env alone if it cannot be read. */
  private async readSchedule(): Promise<ReadingSchedule> {
    let stored: ReadonlyMap<string, unknown> = new Map();
    try {
      stored = await readSettings(this.svc.pool, this.svc.schema, [
        SCHEDULED_READING_SETTING,
        READING_TIME_SETTING,
        READ_ON_START_SETTING,
      ]);
    } catch (error) {
      this.logger.warn(`Could not read the reading schedule: ${String(error)}`);
    }
    return readingSchedule(this.config, stored);
  }

  /**
   * Starts (or stops, for null) the daily run when its schedule changed: a
   * change in Settings takes effect within a poll, without a restart.
   */
  private async applySchedule(cron: string | null): Promise<void> {
    if (cron === this.cron) return;
    this.job?.stop();
    this.job = cron
      ? new Cron(
          cron,
          { name: 'parse', protect: true, timezone: this.config.timezone },
          () => this.trigger('schedule'),
        )
      : undefined;
    this.cron = cron;
    const next = this.job?.nextRun() ?? null;
    await this.parse.queue.setNextScheduledRun(next);
    this.logger.log(
      cron
        ? `Parsing on "${cron}"${this.config.timezone ? ` (${this.config.timezone})` : ''}, next run ${next?.toISOString()}`
        : 'No daily reading (turned off in Settings): documents are read when you press Parse now',
    );
  }

  /**
   * Parse now: the ingestion API sends NOTIFY parse_requested. One pooled
   * connection stays subscribed; if it drops, it reconnects after a pause.
   */
  private async listen(): Promise<void> {
    try {
      const client = await this.svc.pool.connect();
      client.on('notification', (message) => {
        if (message.channel === 'parse_requested')
          void this.trigger('parse now');
      });
      client.on('error', (error) => {
        this.logger.warn(`Parse-now listener lost: ${String(error)}`);
        client.release(error);
        if (this.listener === client) this.listener = undefined;
        this.retryListen();
      });
      await client.query('LISTEN parse_requested');
      this.listener = client;
    } catch (error) {
      this.logger.warn(`Could not listen for Parse now: ${String(error)}`);
      this.retryListen();
    }
  }

  /**
   * The fallback for a lost NOTIFY: a Parse now request newer than the last
   * run start, seen while no run is going, starts one.
   */
  private pollRequests(): void {
    if (this.stopping) return;
    this.requestPoll = setTimeout(async () => {
      await this.beat();
      try {
        await this.applySchedule((await this.readSchedule()).cron);
      } catch (error) {
        this.logger.warn(`Could not update the schedule: ${String(error)}`);
      }
      try {
        const queue = this.current ? null : await this.parse.queue.get();
        if (
          queue &&
          requestedSinceLastRun(queue) &&
          // A pause or a credentials block ends on its own terms, not here.
          !this.parse.queue.isPaused(queue) &&
          queue.status !== 'BLOCKED_CREDENTIALS'
        )
          void this.trigger('parse now (found by polling)');
      } catch (error) {
        this.logger.warn(`Could not check for Parse now: ${String(error)}`);
      }
      this.pollRequests();
    }, this.pollMs);
    this.requestPoll.unref();
  }

  /**
   * Says the worker is alive (parse_queue.worker_seen_at), so the inbox can
   * tell you when it is not running instead of waiting for nothing.
   */
  private async beat(alive = true): Promise<void> {
    try {
      await this.svc.pool.query(
        `insert into ingestion.parse_queue (id, worker_seen_at)
         values ($1, case when $2 then now() end)
         on conflict (id) do update set worker_seen_at = excluded.worker_seen_at`,
        [PARSE_QUEUE_ID, alive],
      );
    } catch (error) {
      this.logger.warn(`Could not record the heartbeat: ${String(error)}`);
    }
  }

  private retryListen(): void {
    if (this.stopping) return;
    clearTimeout(this.listenRetry);
    this.listenRetry = setTimeout(() => void this.listen(), 10_000);
    this.listenRetry.unref();
  }

  private async runRequestedSinceLastRun(): Promise<boolean> {
    return requestedSinceLastRun(await this.parse.queue.get());
  }

  async onApplicationShutdown(): Promise<void> {
    this.stopping = true;
    this.job?.stop();
    clearTimeout(this.wakeTimer);
    clearTimeout(this.listenRetry);
    clearTimeout(this.requestPoll);
    await this.beat(false);
    if (this.listener) {
      await this.listener.query('UNLISTEN *').catch(() => undefined);
      this.listener.release();
      this.listener = undefined;
    }
    this.parse.requestStop();
    await this.current;
  }

  trigger(reason: string): Promise<void> {
    if (this.current && reason === 'parse now') this.rerun = true;
    this.current ??= (async () => {
      const started = Date.now();
      try {
        const summary = await this.parse.runOnce(
          reason.startsWith('parse now'),
        );
        const counts = Object.entries(summary)
          .filter(([, count]) => count > 0)
          .map(([outcome, count]) => `${count} ${outcome}`)
          .join(', ');
        this.logger.log(
          `Run (${reason}) done in ${Date.now() - started} ms: ${counts || 'nothing to do'}`,
        );
      } catch (error) {
        this.logger.error(`Run (${reason}) crashed: ${String(error)}`);
      } finally {
        this.current = undefined;
        await this.parse.queue
          .setNextScheduledRun(this.job?.nextRun() ?? null)
          .catch(() => undefined);
        if (!this.stopping && this.rerun) {
          this.rerun = false;
          void this.trigger('parse now (requested during the last run)');
        } else if (!this.stopping)
          await this.scheduleWake().catch(() => undefined);
      }
    })();
    return this.current;
  }

  /**
   * When to run next outside the daily schedule. While the queue is paused,
   * only the pause's end counts (nothing else may call the AI before it); a
   * credentials block waits for the next daily run or a restart. Otherwise the
   * earliest retry or abandoned lease, if it comes before the daily run.
   */
  async nextWakeAt(now = new Date()): Promise<Date | null> {
    const queue = await this.parse.queue.get();
    if (queue.status === 'BLOCKED_CREDENTIALS') return null;
    if (this.parse.queue.isPaused(queue, now)) return queue.resumeAt;
    const { rows } = await this.svc.pool.query<{ at: Date | null }>(
      `select least(
         (select min(next_attempt_at) from ingestion.uploads
           where status in ('PAUSED_QUOTA', 'PAUSED_RATE_LIMIT')
              or (status = 'TO_BE_PARSED' and attempts > 0)),
         (select min(locked_until) from ingestion.uploads where status = 'PARSING')
       ) as at`,
    );
    const at = rows[0]?.at ?? null;
    const nextRun = this.job?.nextRun() ?? null;
    if (!at || (nextRun && at >= nextRun)) return null;
    return at;
  }

  private async scheduleWake(): Promise<void> {
    clearTimeout(this.wakeTimer);
    const at = await this.nextWakeAt();
    if (!at) return;
    // A second late, never early: timers can fire a little before their time,
    // and a document due at `at` must be claimable when the run starts.
    const delay = Math.max(1000, at.getTime() - Date.now() + 1000);
    this.logger.log(
      `Resuming work at ${new Date(Date.now() + delay).toISOString()}`,
    );
    this.wakeTimer = setTimeout(
      () =>
        delay > MAX_TIMER_MS
          ? void this.scheduleWake()
          : void this.trigger('resume'),
      Math.min(delay, MAX_TIMER_MS),
    );
  }
}
