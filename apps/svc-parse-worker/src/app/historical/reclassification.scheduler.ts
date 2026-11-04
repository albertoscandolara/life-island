import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import type { ServiceDb } from '@life-island/be-common';
import {
  RECLASSIFY_CHANNEL,
  TAXONOMY_STATE_ID,
  type ReclassificationRunRow,
} from '@life-island/ingestion-db';
import { Cron } from 'croner';
import type pg from 'pg';
import { CONFIG, SERVICE_DB, type WorkerConfig } from '../config.js';
import { ParseScheduler } from '../scheduler.js';
import { ReclassificationService } from './reclassification.service.js';

/**
 * Starts historical reclassification once a month (RECLASSIFY_SCHEDULE, the
 * 1st at 03:00 by default) and picks up the runs Reclassify now starts
 * through the API (NOTIFY reclassify_requested). A scheduled attempt that is
 * blocked (suggestions waiting, parser busy, AI paused) is recorded and
 * simply waits for next month: there are no retries in between.
 */
@Injectable()
export class ReclassificationScheduler
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private readonly logger = new Logger(ReclassificationScheduler.name);
  private job?: Cron;
  private current?: Promise<void>;
  private stopping = false;
  private listener?: pg.PoolClient;
  private listenRetry?: NodeJS.Timeout;

  constructor(
    @Inject(ReclassificationService)
    private readonly reclassification: ReclassificationService,
    @Inject(ParseScheduler) private readonly parse: ParseScheduler,
    @Inject(CONFIG) private readonly config: WorkerConfig,
    @Inject(SERVICE_DB) private readonly svc: ServiceDb,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    const ended = await this.reclassification.recoverStale();
    if (ended)
      this.logger.warn(
        `Ended ${ended} reclassification run(s) left by a crash`,
      );
    if (this.config.reclassifySchedule) {
      this.job = new Cron(
        this.config.reclassifySchedule,
        {
          name: 'reclassify',
          protect: true,
          timezone: this.config.reclassifyTimezone,
        },
        () => void this.scheduled(),
      );
      this.logger.log(
        `Reclassification on "${this.config.reclassifySchedule}", next run ${this.job.nextRun()?.toISOString()}`,
      );
    } else this.logger.log('Scheduled reclassification is off');
    await this.saveNextRun();
    await this.listen();
    // A run Reclassify now started while this process was down.
    void this.pickUp('started while stopped');
  }

  async onApplicationShutdown(): Promise<void> {
    this.stopping = true;
    this.job?.stop();
    clearTimeout(this.listenRetry);
    if (this.listener) {
      await this.listener.query('UNLISTEN *').catch(() => undefined);
      this.listener.release();
      this.listener = undefined;
    }
    this.reclassification.requestStop();
    await this.current;
  }

  /** The monthly attempt: start if every prerequisite holds, else record why not. */
  async scheduled(): Promise<void> {
    if (this.current || this.stopping) return;
    try {
      const result = await this.reclassification.start('SCHEDULED');
      if (result.started) await this.execute(result.run, 'monthly schedule');
      else
        this.logger.warn(
          `Monthly reclassification blocked, waiting for next month: ${result.reasons
            .map((reason) => reason.message)
            .join('; ')}`,
        );
    } catch (error) {
      this.logger.error(
        `Monthly reclassification failed to start: ${String(error)}`,
      );
    } finally {
      await this.saveNextRun().catch(() => undefined);
    }
  }

  /** Works on the live RUNNING run, if there is one and none is in progress here. */
  async pickUp(reason: string): Promise<void> {
    if (this.current || this.stopping) return;
    const run = await this.reclassification.runningRun().catch(() => undefined);
    if (run) await this.execute(run, reason);
  }

  private execute(run: ReclassificationRunRow, reason: string): Promise<void> {
    this.current ??= (async () => {
      this.logger.log(`Reclassification ${run.id} (${reason}) starting`);
      try {
        await this.reclassification.run(run);
      } catch (error) {
        this.logger.error(
          `Reclassification ${run.id} crashed: ${String(error)}`,
        );
      } finally {
        this.current = undefined;
      }
      // Uploads and Parse now waited for the lock: let the parser catch up.
      if (!this.stopping) void this.parse.trigger('after reclassification');
    })();
    return this.current;
  }

  private async saveNextRun(): Promise<void> {
    await this.svc.pool.query(
      `insert into ingestion.taxonomy_state (id, version, next_reclassification_at)
       values ($1, 0, $2)
       on conflict (id) do update
         set next_reclassification_at = excluded.next_reclassification_at`,
      [TAXONOMY_STATE_ID, this.job?.nextRun() ?? null],
    );
  }

  private async listen(): Promise<void> {
    try {
      const client = await this.svc.pool.connect();
      client.on('notification', (message) => {
        if (message.channel === RECLASSIFY_CHANNEL)
          void this.pickUp('reclassify now');
      });
      client.on('error', (error) => {
        this.logger.warn(`Reclassify listener lost: ${String(error)}`);
        client.release(error);
        if (this.listener === client) this.listener = undefined;
        this.retryListen();
      });
      await client.query(`LISTEN ${RECLASSIFY_CHANNEL}`);
      this.listener = client;
    } catch (error) {
      this.logger.warn(`Could not listen for Reclassify now: ${String(error)}`);
      this.retryListen();
    }
  }

  private retryListen(): void {
    if (this.stopping) return;
    clearTimeout(this.listenRetry);
    this.listenRetry = setTimeout(() => {
      void this.listen();
      // A NOTIFY sent while disconnected is lost: look for the run directly.
      void this.pickUp('reclassify now (after reconnecting)');
    }, 10_000);
    this.listenRetry.unref();
  }
}
