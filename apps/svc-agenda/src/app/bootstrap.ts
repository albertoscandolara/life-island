import { Logger, type INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { createServiceDb, migrateServiceSchema } from '@life-island/be-common';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { AppModule } from './app.module.js';
import { LOCAL_AGENDA_DATABASE_URL, type ServiceConfig } from './config.js';

export const MIGRATIONS_FOLDER = fileURLToPath(
  new URL('../../drizzle', import.meta.url),
);

/** The upgrade that adds the agenda schema and role to an older database (`npm run db:upgrade`). */
export const SCHEMA_UPGRADE = fileURLToPath(
  new URL(
    '../../../../infra/postgres/upgrades/007-agenda-schema.sql',
    import.meta.url,
  ),
);

const logger = new Logger('Bootstrap');

/** Applies this service's migrations, only ever touching the agenda schema. */
export async function runMigrations(databaseUrl: string): Promise<void> {
  const svc = createServiceDb({
    connectionString: databaseUrl,
    schema: 'agenda',
    max: 1,
  });
  try {
    await migrateServiceSchema(svc.pool, svc.schema, MIGRATIONS_FOLDER);
  } finally {
    await svc.close();
  }
}

/** The role does not exist yet (Postgres answers as for a wrong password), or its schema does not. */
function isMissingRoleOrSchema(error: unknown): boolean {
  const code = (error as { code?: string } | null)?.code;
  return code === '28P01' || code === '28000' || code === '3F000';
}

/**
 * On your machine, with the default connection of the compose stack, a
 * database created before Agenda existed has no agenda role or schema yet: they
 * are added with the stack's own superuser, as `npm run db:upgrade` would, so
 * `npm run dev` works with the .env you already have. Anywhere else (another
 * URL, a container) nothing is done and the error stays.
 */
export async function ensureLocalSchema(
  config: Pick<ServiceConfig, 'databaseUrl'>,
  env: NodeJS.ProcessEnv = process.env,
): Promise<boolean> {
  if (config.databaseUrl !== LOCAL_AGENDA_DATABASE_URL) return false;
  const admin = new pg.Client({
    host: 'localhost',
    port: Number(env['POSTGRES_PORT'] || 5432),
    user: env['POSTGRES_USER'] || 'postgres',
    password: env['POSTGRES_PASSWORD'] || 'postgres',
    database: 'life_island',
  });
  try {
    const sql = await readFile(SCHEMA_UPGRADE, 'utf8');
    await admin.connect();
    await admin.query(sql);
    logger.log('Added the agenda schema and role to your local database');
    return true;
  } catch (error) {
    logger.error(
      `The agenda schema is missing and could not be added (${String(error)}). Run npm run db:upgrade.`,
    );
    return false;
  } finally {
    await admin.end().catch(() => undefined);
  }
}

export async function createApp(
  config: ServiceConfig,
  options: { events?: boolean } = {},
): Promise<INestApplication> {
  try {
    await runMigrations(config.databaseUrl);
  } catch (error) {
    if (!isMissingRoleOrSchema(error) || !(await ensureLocalSchema(config)))
      throw error;
    await runMigrations(config.databaseUrl);
  }
  const app = await NestFactory.create(AppModule.forRoot(config, options));
  app.enableShutdownHooks();
  return app;
}
