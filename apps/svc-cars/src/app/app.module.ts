import { Logger, Module, type DynamicModule } from '@nestjs/common';
import {
  createServiceDb,
  PAYMENT_EVENTS,
  paymentEventHandler,
  settingChangedHandler,
  startEventConsumer,
  type ServiceDb,
} from '@life-island/be-common';
import { EventsRuntime, IngestionFiles } from '@life-island/be-nest';
import { SETTING_CHANGED_EVENT } from '@life-island/contracts';
import { CarModels } from './cars/car-models.js';
import { CarPeople } from './cars/car-people.js';
import { CarsController } from './cars/cars.controller.js';
import { CarsService } from './cars/cars.service.js';
import { QuoteAdvisor } from './cars/quote-advisor.js';
import { CONFIG, SERVICE_DB, type CarsConfig } from './config.js';
import {
  applyDocumentEvent,
  DOCUMENT_EVENTS,
} from './documents/document-events.handler.js';
import { DocumentsController } from './documents/documents.controller.js';
import { CarExportsController } from './exports/car-exports.controller.js';
import { CarExportsService } from './exports/car-exports.service.js';
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
      controllers: [
        HealthController,
        CarsController,
        CarExportsController,
        DocumentsController,
      ],
      providers: [
        { provide: CONFIG, useValue: config },
        { provide: SERVICE_DB, useValue: svc },
        CarsService,
        CarExportsService,
        CarModels,
        CarPeople,
        QuoteAdvisor,
        {
          provide: IngestionFiles,
          useValue: new IngestionFiles(config.ingestionUrl),
        },
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
                      // The switch of the insurance quote comparison (svc-settings).
                      await startEventConsumer({
                        pool: db.pool,
                        nats,
                        schema: db.schema,
                        durableName: 'cars-settings',
                        eventTypes: [SETTING_CHANGED_EVENT],
                        handle: settingChangedHandler(db.schema),
                        onError: (error, subject) =>
                          logger.error(
                            `Failed to apply ${subject}: ${String(error)}`,
                          ),
                      });
                      // The bank payments you match to costs and fines in Money.
                      await startEventConsumer({
                        pool: db.pool,
                        nats,
                        schema: db.schema,
                        durableName: 'cars-payments',
                        eventTypes: PAYMENT_EVENTS,
                        handle: paymentEventHandler(db.schema, 'cars'),
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
