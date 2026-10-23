import { type INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { createServiceDb, migrateServiceSchema } from '@life-island/be-common';
import { fileURLToPath } from 'node:url';
import { AppModule } from './app.module.js';
import type { ReviewConfig } from './config.js';

export const MIGRATIONS_FOLDER = fileURLToPath(
  new URL('../../drizzle', import.meta.url),
);

export async function runMigrations(databaseUrl: string): Promise<void> {
  const svc = createServiceDb({
    connectionString: databaseUrl,
    schema: 'review',
    max: 1,
  });
  try {
    await migrateServiceSchema(svc.pool, svc.schema, MIGRATIONS_FOLDER);
  } finally {
    await svc.close();
  }
}

export async function createApp(
  config: ReviewConfig,
  options: { events?: boolean } = {},
): Promise<INestApplication> {
  await runMigrations(config.databaseUrl);
  const app = await NestFactory.create(AppModule.forRoot(config, options));
  app.enableShutdownHooks();
  return app;
}
