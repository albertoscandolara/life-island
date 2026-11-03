import { Logger, Module, type DynamicModule } from '@nestjs/common';
import {
  createServiceDb,
  recordApprovedHandler,
  startEventConsumer,
  type ServiceDb,
} from '@life-island/be-common';
import { EventsRuntime } from '@life-island/be-nest';
import { RECORD_APPROVED_EVENT } from '@life-island/contracts';
import { CONFIG, SERVICE_DB, type Tax730Config } from './config.js';
import {
  applyDocumentEvent,
  DOCUMENT_EVENTS,
} from './documents/document-events.handler.js';
import { DossierController } from './dossier/dossier.controller.js';
import { DossierService } from './dossier/dossier.service.js';
import { ExportsService } from './exports/exports.service.js';
import { IngestionFiles } from './exports/ingestion-files.js';
import { HealthController } from './health.controller.js';
import { expenseLoader } from './expenses/expense-loader.js';
import { ExpensesController } from './expenses/expenses.controller.js';
import { ExpensesService } from './expenses/expenses.service.js';

const logger = new Logger('RecordApproved');

@Module({})
export class AppModule {
  static forRoot(
    config: Tax730Config,
    options: { events?: boolean } = {},
  ): DynamicModule {
    const svc = createServiceDb({
      connectionString: config.databaseUrl,
      schema: 'tax730',
    });
    return {
      module: AppModule,
      controllers: [HealthController, ExpensesController, DossierController],
      providers: [
        { provide: CONFIG, useValue: config },
        { provide: SERVICE_DB, useValue: svc },
        ExpensesService,
        DossierService,
        IngestionFiles,
        ExportsService,
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
                    serviceName: 'svc-tax730',
                    onConnected: async (nats) => {
                      await startEventConsumer({
                        pool: db.pool,
                        nats,
                        schema: db.schema,
                        durableName: 'tax730-record-approved',
                        eventTypes: [RECORD_APPROVED_EVENT],
                        handle: recordApprovedHandler(db.schema, expenseLoader),
                        onError: (error, subject) =>
                          logger.error(
                            `Failed to load ${subject}: ${String(error)}`,
                          ),
                      });
                      // The documents you upload, so the 730 can file them.
                      await startEventConsumer({
                        pool: db.pool,
                        nats,
                        schema: db.schema,
                        durableName: 'tax730-document-events',
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
