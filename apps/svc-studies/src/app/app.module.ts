import { Logger, Module, type DynamicModule } from '@nestjs/common';
import {
  createServiceDb,
  settingChangedHandler,
  startEventConsumer,
  type ServiceDb,
} from '@life-island/be-common';
import { EventsRuntime } from '@life-island/be-nest';
import {
  aiToolSettingKey,
  SETTING_CHANGED_EVENT,
  STUDY_SCOUT_SUBJECT_SETTING,
  STUDY_SCOUT_TOOL,
} from '@life-island/contracts';
import { CONFIG, SERVICE_DB, type StudiesConfig } from './config.js';
import { HealthController } from './health.controller.js';
import { StudiesController } from './studies/studies.controller.js';
import { ResourceScout } from './studies/resource-scout.js';
import { StudiesService } from './studies/studies.service.js';
import { StudyCoach } from './studies/study-coach.js';

const logger = new Logger('SettingsEvents');

@Module({})
export class AppModule {
  static forRoot(
    config: StudiesConfig,
    options: { events?: boolean } = {},
  ): DynamicModule {
    const svc = createServiceDb({
      connectionString: config.databaseUrl,
      schema: 'studies',
    });
    return {
      module: AppModule,
      controllers: [HealthController, StudiesController],
      providers: [
        { provide: CONFIG, useValue: config },
        { provide: SERVICE_DB, useValue: svc },
        StudiesService,
        StudyCoach,
        ResourceScout,
        ...(options.events === false
          ? []
          : [
              {
                provide: EventsRuntime,
                useFactory: (db: ServiceDb, scout: ResourceScout) =>
                  new EventsRuntime({
                    pool: db.pool,
                    natsUrl: config.natsUrl,
                    schema: db.schema,
                    serviceName: 'svc-studies',
                    onConnected: async (nats) => {
                      // The AI switch, the weekly goal and the reminder
                      // windows (svc-settings).
                      await startEventConsumer({
                        pool: db.pool,
                        nats,
                        schema: db.schema,
                        durableName: 'studies-settings',
                        eventTypes: [SETTING_CHANGED_EVENT],
                        handle: scoutAware(
                          settingChangedHandler(db.schema),
                          scout,
                        ),
                        onError: (error, subject) =>
                          logger.error(
                            `Failed to apply ${subject}: ${String(error)}`,
                          ),
                      });
                    },
                  }),
                inject: [SERVICE_DB, ResourceScout],
              },
            ]),
      ],
    };
  }
}

type SettingHandler = ReturnType<typeof settingChangedHandler>;

/**
 * Picking the path to keep current, or turning the scout on, starts its
 * first scan within seconds, not at the next check.
 */
function scoutAware(
  handle: SettingHandler,
  scout: ResourceScout,
): SettingHandler {
  const watched = [
    STUDY_SCOUT_SUBJECT_SETTING,
    aiToolSettingKey(STUDY_SCOUT_TOOL),
  ];
  return async (event, client) => {
    await handle(event, client);
    const key = (event.payload as { key?: unknown } | null)?.key;
    if (typeof key === 'string' && watched.includes(key)) scout.soon();
  };
}
