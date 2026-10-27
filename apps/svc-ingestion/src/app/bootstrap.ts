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

/** Storage has no health check in compose and can still be starting right after `infra:up`. */
async function ensureBucketWithRetry(
  storage: ObjectStorage,
  origins: string[],
  attempts = 10,
): Promise<void> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await storage.ensureBucket(origins);
    } catch (error) {
      if (attempt >= attempts) throw error;
      Logger.warn(
        `Storage not reachable yet (attempt ${attempt}/${attempts}), retrying`,
        'Bootstrap',
      );
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }
}

export async function createApp(
  config: IngestionConfig,
  options: { events?: boolean } = {},
): Promise<INestApplication> {
  await runMigrations(config.databaseUrl);
  await ensureBucketWithRetry(
    new ObjectStorage(config.storage),
    config.storageCorsOrigins,
  );
  const app = await NestFactory.create(AppModule.forRoot(config, options), {
    logger: new Logger(),
    bufferLogs: false,
  });
  app.enableShutdownHooks();
  return app;
}
