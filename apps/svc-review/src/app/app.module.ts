import { Logger, Module, type DynamicModule } from '@nestjs/common';
import {
  createServiceDb,
  startEventConsumer,
  type ServiceDb,
} from '@life-island/be-common';
import { EventsRuntime } from '@life-island/be-nest';
import { CatalogController } from './catalog/catalog.controller.js';
import { CONFIG, SERVICE_DB, type ReviewConfig } from './config.js';
import { HealthController } from './health.controller.js';
import {
  applyDocumentEvent,
  HANDLED_EVENTS,
} from './records/document-events.handler.js';
import { RecordsController } from './records/records.controller.js';
import { RecordsService } from './records/records.service.js';

const logger = new Logger('DocumentEvents');

@Module({})
export class AppModule {
  static forRoot(
    config: ReviewConfig,
    options: { events?: boolean } = {},
  ): DynamicModule {
    const svc = createServiceDb({
      connectionString: config.databaseUrl,
      schema: 'review',
    });
    return {
      module: AppModule,
      controllers: [HealthController, CatalogController, RecordsController],
      providers: [
        { provide: CONFIG, useValue: config },
        { provide: SERVICE_DB, useValue: svc },
        RecordsService,
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
                    serviceName: 'svc-review',
                    onConnected: async (nats) => {
                      await startEventConsumer({
                        pool: db.pool,
                        nats,
                        schema: db.schema,
                        durableName: 'review-document-events',
                        eventTypes: HANDLED_EVENTS,
                        handle: applyDocumentEvent,
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
