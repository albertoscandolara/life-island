import { defineConfig } from 'drizzle-kit';

// Generates SQL migrations for the `ingestion` schema into ./drizzle.
// `npx drizzle-kit generate --config apps/svc-ingestion/drizzle.config.ts`
export default defineConfig({
  dialect: 'postgresql',
  schema: '../../libs/ingestion-db/src/lib/schema.ts',
  out: './drizzle',
  schemaFilter: ['ingestion'],
  // Applied at startup by migrateServiceSchema (libs/be-common), never by drizzle-kit migrate.
  migrations: { schema: 'ingestion', table: '__drizzle_migrations' },
});
