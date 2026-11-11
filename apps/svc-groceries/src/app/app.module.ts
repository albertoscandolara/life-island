import { Logger, Module, type DynamicModule } from '@nestjs/common';
import {
  createServiceDb,
  recordApprovedHandler,
  settingChangedHandler,
  startEventConsumer,
  type ServiceDb,
} from '@life-island/be-common';
import { EventsRuntime } from '@life-island/be-nest';
import {
  RECORD_APPROVED_EVENT,
  SETTING_CHANGED_EVENT,
} from '@life-island/contracts';
import { CONFIG, SERVICE_DB, type GroceriesConfig } from './config.js';
import { HealthController } from './health.controller.js';
import { receiptLoader } from './receipts/receipt-loader.js';
import { ReceiptsController } from './receipts/receipts.controller.js';
import { ReceiptsService } from './receipts/receipts.service.js';
import {
  LIST_RECORDS,
  listCollections,
  ShoppingController,
} from './shopping/shopping.controller.js';
import { ShoppingService } from './shopping/shopping.service.js';

const logger = new Logger('RecordApproved');

@Module({})
export class AppModule {
  static forRoot(
    config: GroceriesConfig,
    options: { events?: boolean } = {},
  ): DynamicModule {
    const svc = createServiceDb({
      connectionString: config.databaseUrl,
      schema: 'grocery',
    });
    return {
      module: AppModule,
      controllers: [HealthController, ReceiptsController, ShoppingController],
      providers: [
        { provide: CONFIG, useValue: config },
        { provide: SERVICE_DB, useValue: svc },
        ReceiptsService,
        ShoppingService,
        {
          provide: LIST_RECORDS,
          useFactory: (db: ServiceDb) => listCollections(db.db),
          inject: [SERVICE_DB],
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
                    serviceName: 'svc-groceries',
                    onConnected: async (nats) => {
                      await startEventConsumer({
                        pool: db.pool,
                        nats,
                        schema: db.schema,
                        durableName: 'grocery-record-approved',
                        eventTypes: [RECORD_APPROVED_EVENT],
                        handle: recordApprovedHandler(db.schema, receiptLoader),
                        onError: (error, subject) =>
                          logger.error(
                            `Failed to load ${subject}: ${String(error)}`,
                          ),
                      });
                      // The AI switches (svc-settings), for the shopping list.
                      await startEventConsumer({
                        pool: db.pool,
                        nats,
                        schema: db.schema,
                        durableName: 'grocery-settings',
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
