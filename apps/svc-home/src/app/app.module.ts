import { Logger, Module, type DynamicModule } from '@nestjs/common';
import {
  createServiceDb,
  startEventConsumer,
  type ServiceDb,
} from '@life-island/be-common';
import { EventsRuntime } from '@life-island/be-nest';
import { BillLedger } from './bills/bill-ledger.js';
import { BillsController } from './bills/bills.controller.js';
import { BillsService } from './bills/bills.service.js';
import { SupplyPointsController } from './bills/supply-points.controller.js';
import { CONFIG, SERVICE_DB, type HomeConfig } from './config.js';
import {
  applyDocumentEvent,
  DOCUMENT_EVENTS,
} from './documents/document-events.handler.js';
import { DocumentsController } from './documents/documents.controller.js';
import { IngestionFiles } from './documents/ingestion-files.js';
import { HealthController } from './health.controller.js';
import { HouseSuggestionsService } from './houses/house-suggestions.service.js';
import { HousesController } from './houses/houses.controller.js';
import { HomePeople } from './properties/home-people.js';
import { HouseModels } from './properties/house-models.js';
import { PropertiesController } from './properties/properties.controller.js';
import { PropertiesService } from './properties/properties.service.js';
import { PropertyCategories } from './properties/property-categories.js';
import { WorksController } from './works/works.controller.js';
import { WorksService } from './works/works.service.js';

const logger = new Logger('DocumentEvents');

@Module({})
export class AppModule {
  static forRoot(
    config: HomeConfig,
    options: { events?: boolean } = {},
  ): DynamicModule {
    const svc = createServiceDb({
      connectionString: config.databaseUrl,
      schema: 'home',
    });
    return {
      module: AppModule,
      controllers: [
        HealthController,
        PropertiesController,
        BillsController,
        WorksController,
        DocumentsController,
        HousesController,
        SupplyPointsController,
      ],
      providers: [
        { provide: CONFIG, useValue: config },
        { provide: SERVICE_DB, useValue: svc },
        PropertiesService,
        PropertyCategories,
        BillLedger,
        BillsService,
        WorksService,
        IngestionFiles,
        HouseModels,
        HomePeople,
        HouseSuggestionsService,
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
                    serviceName: 'svc-home',
                    onConnected: async (nats) => {
                      // The documents you upload and their categories: bills
                      // are read from them, works attach them.
                      await startEventConsumer({
                        pool: db.pool,
                        nats,
                        schema: db.schema,
                        durableName: 'home-document-events',
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
