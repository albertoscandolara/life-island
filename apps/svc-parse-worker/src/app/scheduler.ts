import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import type { ServiceDb } from '@life-island/be-common';
import { Cron } from 'croner';
import { CONFIG, SERVICE_DB, type WorkerConfig } from './config.js';
import { ParseService } from './parse.service.js';

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

  constructor(
    @Inject(ParseService) private readonly parse: ParseService,
    @Inject(CONFIG) private readonly config: WorkerConfig,
    @Inject(SERVICE_DB) private readonly svc: ServiceDb,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    this.job = new Cron(
      this.config.schedule,
      { name: 'parse', protect: true, timezone: this.config.timezone },
      () => this.trigger('schedule'),
    );
    const next = this.job.nextRun();
    await this.parse.queue.setNextScheduledRun(next);
    this.logger.log(
      `Parsing on "${this.config.schedule}"${this.config.timezone ? ` (${this.config.timezone})` : ''}, next run ${next?.toISOString()}`,
    );
    if (this.config.runOnStart) void this.trigger('startup');
    else if (await this.parse.queue.wasInterrupted())
      void this.trigger('recovery after restart');
    else await this.scheduleWake();
  }

  async onApplicationShutdown(): Promise<void> {
    this.stopping = true;
    this.job?.stop();
    clearTimeout(this.wakeTimer);
    this.parse.requestStop();
    await this.current;
  }

  trigger(reason: string): Promise<void> {
    this.current ??= (async () => {
      const started = Date.now();
      try {
        const summary = await this.parse.runOnce();
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
        if (!this.stopping) await this.scheduleWake().catch(() => undefined);
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
