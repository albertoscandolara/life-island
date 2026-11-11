import { Logger, Module, type DynamicModule } from '@nestjs/common';
import {
  createServiceDb,
  settingChangedHandler,
  startEventConsumer,
  type ServiceDb,
} from '@life-island/be-common';
import { EventsRuntime, RecordCollections } from '@life-island/be-nest';
import { SETTING_CHANGED_EVENT } from '@life-island/contracts';
import { CONFIG, SERVICE_DB, type ServiceConfig } from './config.js';
import { HealthController } from './health.controller.js';
import { RecordsController } from './records.controller.js';
import { TravelController } from './travel/travel.controller.js';
import { TravelService } from './travel/travel.service.js';
import { collections, RECORDS } from './travel/collections.js';

const logger = new Logger('SettingsEvents');

@Module({})
export class AppModule {
  static forRoot(
    config: ServiceConfig,
    options: { events?: boolean } = {},
  ): DynamicModule {
    const svc = createServiceDb({
      connectionString: config.databaseUrl,
      schema: 'travel',
    });
    return {
      module: AppModule,
      // Travel's own routes first: the records' `/:collection` routes match anything.
      controllers: [HealthController, TravelController, RecordsController],
      providers: [
        { provide: CONFIG, useValue: config },
        { provide: SERVICE_DB, useValue: svc },
        {
          provide: RECORDS,
          useFactory: (db: ServiceDb) =>
            new RecordCollections(db.db, collections(db.db)),
          inject: [SERVICE_DB],
        },
        TravelService,
        ...(options.events === false
          ? []
          : [
              {
                provide: EventsRuntime,
                useFactory: (db: ServiceDb) =>
                  new EventsRuntime({
                    pool: db.pool,
                    natsUrl: config.natsUrl,
                    schema: db.schema,
                    serviceName: 'svc-travel',
                    onConnected: async (nats) => {
                      // The AI switches and Travel's settings (svc-settings).
                      await startEventConsumer({
                        pool: db.pool,
                        nats,
                        schema: db.schema,
                        durableName: 'travel-settings',
                        eventTypes: [SETTING_CHANGED_EVENT],
                        handle: settingChangedHandler(db.schema),
                        onError: (error, subject) =>
                          logger.error(
                            `Failed to apply ${subject}: ${String(error)}`,
                          ),
                      });
                    },
                  }),
                inject: [SERVICE_DB],
              },
            ]),
      ],
    };
  }
}
