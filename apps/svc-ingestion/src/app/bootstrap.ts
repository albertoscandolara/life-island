import { Logger, type INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import {
  createServiceDb,
  migrateServiceSchema,
  ObjectStorage,
} from '@life-island/be-common';
import { fileURLToPath } from 'node:url';
import { AppModule } from './app.module.js';
import type { IngestionConfig } from './config.js';

export const MIGRATIONS_FOLDER = fileURLToPath(
  new URL('../../drizzle', import.meta.url),
);

/** Applies this service's migrations, only ever touching the ingestion schema. */
export async function runMigrations(databaseUrl: string): Promise<void> {
  const svc = createServiceDb({
    connectionString: databaseUrl,
    schema: 'ingestion',
    max: 1,
  });
  try {
    await migrateServiceSchema(svc.pool, svc.schema, MIGRATIONS_FOLDER);
  } finally {
    await svc.close();
  }
}

export async function createApp(
  config: IngestionConfig,
  options: { events?: boolean } = {},
): Promise<INestApplication> {
  await runMigrations(config.databaseUrl);
  await new ObjectStorage(config.storage).ensureBucket(
    config.storageCorsOrigins,
  );
  const app = await NestFactory.create(AppModule.forRoot(config, options), {
    logger: new Logger(),
    bufferLogs: false,
  });
  app.enableShutdownHooks();
  return app;
}
