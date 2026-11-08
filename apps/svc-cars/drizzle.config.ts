import { defineConfig } from 'drizzle-kit';

// Generates SQL migrations for the `cars` schema into ./drizzle.
// Run from this folder: `npx drizzle-kit generate --name <change>`.
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/app/db/schema.ts',
  out: './drizzle',
  schemaFilter: ['cars'],
  // Applied at startup by migrateServiceSchema (libs/be-common), never by drizzle-kit migrate.
  migrations: { schema: 'cars', table: '__drizzle_migrations' },
});
