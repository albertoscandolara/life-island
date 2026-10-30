import { Module, type DynamicModule } from '@nestjs/common';
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
      controllers: [HealthController, UploadsController, CategoriesController],
      providers: [
        { provide: CONFIG, useValue: config },
        { provide: SERVICE_DB, useValue: svc },
        { provide: STORAGE, useValue: storage },
        UploadsService,
        CategoriesService,
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
