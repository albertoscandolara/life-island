import { readMigrationFiles } from 'drizzle-orm/migrator';
import type pg from 'pg';
import { withTransaction } from './db.js';
import { assertSchemaName } from './schema-name.js';

/**
 * Applies the drizzle-kit migrations in `migrationsFolder` to one service schema.
 *
 * drizzle-orm's own migrator starts with `create schema if not exists`, which a
 * service role cannot run (it has no CREATE on the database, by design). This
 * one keeps the same bookkeeping table (`<schema>.__drizzle_migrations`) but
 * never leaves the schema the role owns. An advisory lock keeps two replicas
 * starting together from applying the same migration twice.
 */
export async function migrateServiceSchema(
  pool: pg.Pool,
  schema: string,
  migrationsFolder: string,
): Promise<number> {
  const safeSchema = assertSchemaName(schema);
  const migrations = readMigrationFiles({ migrationsFolder });
  return withTransaction(pool, async (client) => {
    await client.query('select pg_advisory_xact_lock(hashtext($1))', [
      `migrate:${safeSchema}`,
    ]);
    await client.query(
      `create table if not exists ${safeSchema}.__drizzle_migrations (
         id serial primary key,
         hash text not null,
         created_at bigint
       )`,
    );
    const { rows } = await client.query<{ created_at: string | null }>(
      `select created_at from ${safeSchema}.__drizzle_migrations order by created_at desc limit 1`,
    );
    const lastApplied = Number(rows[0]?.created_at ?? 0);
    let applied = 0;
    for (const migration of migrations) {
      if (migration.folderMillis <= lastApplied) continue;
      for (const statement of migration.sql) {
        if (statement.trim()) await client.query(statement);
      }
      await client.query(
        `insert into ${safeSchema}.__drizzle_migrations (hash, created_at) values ($1, $2)`,
        [migration.hash, migration.folderMillis],
      );
      applied++;
    }
    return applied;
  });
}
