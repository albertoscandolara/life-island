import { Module, type DynamicModule } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import {
  createServiceDb,
  ObjectStorage,
  type ServiceDb,
} from '@life-island/be-common';
import { EventsRuntime } from '@life-island/be-nest';
import { CategoriesController } from './categories/categories.controller.js';
import { CategoriesService } from './categories/categories.service.js';
import { CONFIG, SERVICE_DB, STORAGE, type IngestionConfig } from './config.js';
import { HealthController } from './health.controller.js';
import { DocumentLinksController } from './links/document-links.controller.js';
import { DocumentLinksService } from './links/document-links.service.js';
import { ReclassificationLockedFilter } from './reclassification/locked.filter.js';
import { ReclassificationController } from './reclassification/reclassification.controller.js';
import { UploadsController } from './uploads/uploads.controller.js';
import { UploadsService } from './uploads/uploads.service.js';

@Module({})
export class AppModule {
  static forRoot(
    config: IngestionConfig,
    options: { events?: boolean } = {},
  ): DynamicModule {
    const svc = createServiceDb({
      connectionString: config.databaseUrl,
      schema: 'ingestion',
    });
    const storage = new ObjectStorage(config.storage);
    return {
      module: AppModule,
      controllers: [
        HealthController,
        UploadsController,
        CategoriesController,
        ReclassificationController,
        DocumentLinksController,
      ],
      providers: [
        { provide: CONFIG, useValue: config },
        { provide: SERVICE_DB, useValue: svc },
        { provide: STORAGE, useValue: storage },
        { provide: APP_FILTER, useClass: ReclassificationLockedFilter },
        UploadsService,
        CategoriesService,
        DocumentLinksService,
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
                    serviceName: 'svc-ingestion',
                  }),
                inject: [SERVICE_DB],
              },
            ]),
      ],
    };
  }
}
