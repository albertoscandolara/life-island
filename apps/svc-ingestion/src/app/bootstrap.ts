import { Logger, type INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { MAX_UPLOAD_BYTES } from '@life-island/contracts';
import {
  createServiceDb,
  migrateServiceSchema,
  ObjectStorage,
} from '@life-island/be-common';
import { fileURLToPath } from 'node:url';
import { AppModule } from './app.module.js';
import type { IngestionConfig } from './config.js';
import { applyHttpSecurity } from '@life-island/be-nest';

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

/** Storage can still be starting when the service boots (e.g. both started together in production). */
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
  const app = await NestFactory.create<NestExpressApplication>(
    AppModule.forRoot(config, options),
    { logger: new Logger(), bufferLogs: false },
  );
  // Files sent through the API when the browser cannot reach storage (PUT /uploads/:id/file).
  app.useBodyParser('raw', {
    type: 'application/octet-stream',
    limit: MAX_UPLOAD_BYTES + 1024,
  });
  applyHttpSecurity(app, { service: 'svc-ingestion', config });
  app.enableShutdownHooks();
  return app;
}
