import { Logger, Module, type DynamicModule } from '@nestjs/common';
import {
  createServiceDb,
  settingChangedHandler,
  startEventConsumer,
  type ServiceDb,
} from '@life-island/be-common';
import { EventsRuntime } from '@life-island/be-nest';
import { SETTING_CHANGED_EVENT } from '@life-island/contracts';
import { CONFIG, SERVICE_DB, type PeopleConfig } from './config.js';
import {
  applyDocumentEvent,
  DOCUMENT_EVENTS,
} from './documents/document-events.handler.js';
import { DocumentsController } from './documents/documents.controller.js';
import { IngestionFiles } from './documents/ingestion-files.js';
import { HomeHouses } from './people/home-houses.js';
import { HealthController } from './health.controller.js';
import { PeopleController } from './people/people.controller.js';
import { PeopleService } from './people/people.service.js';

const logger = new Logger('DocumentEvents');

@Module({})
export class AppModule {
  static forRoot(
    config: PeopleConfig,
    options: { events?: boolean } = {},
  ): DynamicModule {
    const svc = createServiceDb({
      connectionString: config.databaseUrl,
      schema: 'people',
    });
    return {
      module: AppModule,
      controllers: [HealthController, PeopleController, DocumentsController],
      providers: [
        { provide: CONFIG, useValue: config },
        { provide: SERVICE_DB, useValue: svc },
        PeopleService,
        IngestionFiles,
        HomeHouses,
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
                    serviceName: 'svc-people',
                    onConnected: async (nats) => {
                      // The documents you upload and their categories: ID
                      // documents are read from them.
                      await startEventConsumer({
                        pool: db.pool,
                        nats,
                        schema: db.schema,
                        durableName: 'people-document-events',
                        eventTypes: DOCUMENT_EVENTS,
                        handle: applyDocumentEvent,
                        onError: (error, subject) =>
                          logger.error(
                            `Failed to apply ${subject}: ${String(error)}`,
                          ),
                      });
                      // The reminder windows of the ID documents (svc-settings).
                      await startEventConsumer({
                        pool: db.pool,
                        nats,
                        schema: db.schema,
                        durableName: 'people-reminder-settings',
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
