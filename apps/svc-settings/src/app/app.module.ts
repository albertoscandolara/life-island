import {
  Inject,
  Injectable,
  Logger,
  Module,
  type DynamicModule,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import {
  createServiceDb,
  startEventConsumer,
  type ServiceDb,
} from '@life-island/be-common';
import { EventsRuntime } from '@life-island/be-nest';
import {
  AI_TOOL_DESCRIBED_EVENT,
  AI_TOOL_USED_EVENT,
} from '@life-island/contracts';
import { CONFIG, SERVICE_DB, type SettingsConfig } from './config.js';
import { HealthController } from './health.controller.js';
import { SettingsController } from './settings/settings.controller.js';
import { SettingsService } from './settings/settings.service.js';

const logger = new Logger('Settings');

/** Publishes the stored values again at startup, so every replica catches up. */
@Injectable()
class RepublishOnStart implements OnApplicationBootstrap {
  constructor(
    @Inject(SettingsService) private readonly settings: SettingsService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    const count = await this.settings.republishAll();
    if (count)
      logger.log(`Published ${count} stored settings for the replicas`);
  }
}

/** How often the budget is checked without a use: a new month lifts a stop. */
const BUDGET_CHECK_MS = 60 * 60 * 1000;

/** Checks the monthly AI budget at startup and every hour. */
@Injectable()
class BudgetWatch implements OnApplicationBootstrap, OnApplicationShutdown {
  private timer?: NodeJS.Timeout;

  constructor(
    @Inject(SettingsService) private readonly settings: SettingsService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.check();
    this.timer = setInterval(() => void this.check(), BUDGET_CHECK_MS);
    this.timer.unref();
  }

  onApplicationShutdown(): void {
    clearInterval(this.timer);
  }

  private async check(): Promise<void> {
    try {
      if (await this.settings.checkBudget())
        logger.warn('The monthly AI budget is reached: AI is off');
    } catch (error) {
      logger.error(`Could not check the AI budget: ${String(error)}`);
    }
  }
}

@Module({})
export class AppModule {
  static forRoot(
    config: SettingsConfig,
    options: { events?: boolean } = {},
  ): DynamicModule {
    const svc = createServiceDb({
      connectionString: config.databaseUrl,
      schema: 'settings',
    });
    return {
      module: AppModule,
      controllers: [HealthController, SettingsController],
      providers: [
        { provide: CONFIG, useValue: config },
        { provide: SERVICE_DB, useValue: svc },
        SettingsService,
        ...(options.events === false
          ? []
          : [
              RepublishOnStart,
              BudgetWatch,
              {
                provide: EventsRuntime,
                useFactory: (db: ServiceDb, settings: SettingsService) =>
                  new EventsRuntime({
                    pool: db.pool,
                    natsUrl: config.natsUrl,
                    schema: db.schema,
                    serviceName: 'svc-settings',
                    onConnected: async (nats) => {
                      // How every AI tool calls the model, and what each use cost.
                      await startEventConsumer({
                        pool: db.pool,
                        nats,
                        schema: db.schema,
                        durableName: 'settings-ai-tools',
                        eventTypes: [
                          AI_TOOL_DESCRIBED_EVENT,
                          AI_TOOL_USED_EVENT,
                        ],
                        handle: (event, client) =>
                          event.type === AI_TOOL_DESCRIBED_EVENT
                            ? settings.applyDescribed(event, client)
                            : settings.applyUsed(event, client),
                        onError: (error, subject) =>
                          logger.error(
                            `Failed to apply ${subject}: ${String(error)}`,
                          ),
                      });
                    },
                  }),
                inject: [SERVICE_DB, SettingsService],
              },
            ]),
      ],
    };
  }
}
