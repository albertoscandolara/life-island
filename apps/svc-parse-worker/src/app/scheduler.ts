import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { Cron } from 'croner';
import { CONFIG, type WorkerConfig } from './config.js';
import { ParseService } from './parse.service.js';

/**
 * Runs the parser on the configured cron schedule (PARSE_SCHEDULE, every day
 * at 03:00 by default). `protect` skips a tick while the previous run is still
 * going, and shutdown waits for the run in progress to finish.
 */
@Injectable()
export class ParseScheduler
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private readonly logger = new Logger(ParseScheduler.name);
  private job?: Cron;
  private current?: Promise<void>;

  constructor(
    @Inject(ParseService) private readonly parse: ParseService,
    @Inject(CONFIG) private readonly config: WorkerConfig,
  ) {}

  onApplicationBootstrap(): void {
    this.job = new Cron(
      this.config.schedule,
      { name: 'parse', protect: true, timezone: this.config.timezone },
      () => this.trigger('schedule'),
    );
    this.logger.log(
      `Parsing on "${this.config.schedule}"${this.config.timezone ? ` (${this.config.timezone})` : ''}, next run ${this.job.nextRun()?.toISOString()}`,
    );
    if (this.config.runOnStart) void this.trigger('startup');
  }

  async onApplicationShutdown(): Promise<void> {
    this.job?.stop();
    await this.current;
  }

  trigger(reason: string): Promise<void> {
    this.current ??= (async () => {
      const started = Date.now();
      try {
        const summary = await this.parse.runOnce();
        this.logger.log(
          `Run (${reason}) done in ${Date.now() - started} ms: ${summary.parsed} parsed, ${summary.retried} to retry, ${summary.failed} failed`,
        );
      } catch (error) {
        this.logger.error(`Run (${reason}) crashed: ${String(error)}`);
      } finally {
        this.current = undefined;
      }
    })();
    return this.current;
  }
}
