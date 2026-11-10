import { Logger, Module, type DynamicModule } from '@nestjs/common';
import {
  createServiceDb,
  settingChangedHandler,
  startEventConsumer,
  type ServiceDb,
} from '@life-island/be-common';
import { EventsRuntime } from '@life-island/be-nest';
import { SETTING_CHANGED_EVENT } from '@life-island/contracts';
import { CONFIG, SERVICE_DB, type WorkConfig } from './config.js';
import {
  applyDocumentEvent,
  DOCUMENT_EVENTS,
} from './documents/document-events.handler.js';
import { DocumentsController } from './documents/documents.controller.js';
import { IngestionFiles } from './documents/ingestion-files.js';
import { HealthController } from './health.controller.js';
import { CareerAdvisor } from './work/career-advisor.js';
import { WorkController } from './work/work.controller.js';
import { WorkService } from './work/work.service.js';

const logger = new Logger('DocumentEvents');

@Module({})
export class AppModule {
  static forRoot(
    config: WorkConfig,
    options: { events?: boolean } = {},
  ): DynamicModule {
    const svc = createServiceDb({
      connectionString: config.databaseUrl,
      schema: 'work',
    });
    return {
      module: AppModule,
      controllers: [HealthController, WorkController, DocumentsController],
      providers: [
        { provide: CONFIG, useValue: config },
        { provide: SERVICE_DB, useValue: svc },
        WorkService,
        CareerAdvisor,
        IngestionFiles,
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
                    serviceName: 'svc-work',
                    onConnected: async (nats) => {
                      // The documents you upload and their categories: work
                      // documents are read from them.
                      await startEventConsumer({
                        pool: db.pool,
                        nats,
                        schema: db.schema,
                        durableName: 'work-document-events',
                        eventTypes: DOCUMENT_EVENTS,
                        handle: applyDocumentEvent,
                        onError: (error, subject) =>
                          logger.error(
                            `Failed to apply ${subject}: ${String(error)}`,
                          ),
                      });
                      // The switches of the Work AI tools (svc-settings).
                      await startEventConsumer({
                        pool: db.pool,
                        nats,
                        schema: db.schema,
                        durableName: 'work-settings',
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
