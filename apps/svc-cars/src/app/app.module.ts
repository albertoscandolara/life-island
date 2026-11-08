import { Logger, Module, type DynamicModule } from '@nestjs/common';
import {
  createServiceDb,
  startEventConsumer,
  type ServiceDb,
} from '@life-island/be-common';
import { EventsRuntime } from '@life-island/be-nest';
import { CarModels } from './cars/car-models.js';
import { CarsController } from './cars/cars.controller.js';
import { CarsService } from './cars/cars.service.js';
import { CONFIG, SERVICE_DB, type CarsConfig } from './config.js';
import {
  applyDocumentEvent,
  DOCUMENT_EVENTS,
} from './documents/document-events.handler.js';
import { DocumentsController } from './documents/documents.controller.js';
import { IngestionFiles } from './documents/ingestion-files.js';
import { HealthController } from './health.controller.js';

const logger = new Logger('DocumentEvents');

@Module({})
export class AppModule {
  static forRoot(
    config: CarsConfig,
    options: { events?: boolean } = {},
  ): DynamicModule {
    const svc = createServiceDb({
      connectionString: config.databaseUrl,
      schema: 'cars',
    });
    return {
      module: AppModule,
      controllers: [HealthController, CarsController, DocumentsController],
      providers: [
        { provide: CONFIG, useValue: config },
        { provide: SERVICE_DB, useValue: svc },
        CarsService,
        CarModels,
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
                    serviceName: 'svc-cars',
                    onConnected: async (nats) => {
                      // The documents you upload and their categories: car
                      // documents are read from them.
                      await startEventConsumer({
                        pool: db.pool,
                        nats,
                        schema: db.schema,
                        durableName: 'cars-document-events',
                        eventTypes: DOCUMENT_EVENTS,
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
