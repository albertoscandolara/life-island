import { defineConfig } from 'drizzle-kit';

// Generates SQL migrations for the `goals` schema into ./drizzle.
// Run from this folder: `npx drizzle-kit generate --name <change>`.
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/app/db/schema.ts',
  out: './drizzle',
  schemaFilter: ['goals'],
  // Applied at startup by migrateServiceSchema (libs/be-common), never by drizzle-kit migrate.
  migrations: { schema: 'goals', table: '__drizzle_migrations' },
});
