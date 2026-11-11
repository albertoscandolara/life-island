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
  /** Bookkeeping table; only tests that share a schema with a service change it. */
  table = '__drizzle_migrations',
): Promise<number> {
  const safeSchema = assertSchemaName(schema);
  if (!/^_*[a-z][a-z0-9_]{0,62}$/.test(table))
    throw new Error(`Invalid migrations table name "${table}"`);
  const safeTable = table;
  const migrations = readMigrationFiles({ migrationsFolder });
  return withTransaction(pool, async (client) => {
    await client.query('select pg_advisory_xact_lock(hashtext($1))', [
      `migrate:${safeSchema}`,
    ]);
    await client.query(
      `create table if not exists ${safeSchema}.${safeTable} (
         id serial primary key,
         hash text not null,
         created_at bigint
       )`,
    );
    // A migration is pending when its hash was never recorded, wherever it
    // sits in time: drizzle's own rule (skip anything not newer than the last
    // one applied) silently skips a migration whose journal date is older
    // than one already applied, as happens when branches merge.
    const { rows } = await client.query<{ hash: string }>(
      `select hash from ${safeSchema}.${safeTable}`,
    );
    const done = new Set(rows.map((row) => row.hash));
    let applied = 0;
    for (const migration of migrations) {
      if (done.has(migration.hash)) continue;
      for (const statement of migration.sql) {
        if (statement.trim()) await client.query(statement);
      }
      await client.query(
        `insert into ${safeSchema}.${safeTable} (hash, created_at) values ($1, $2)`,
        [migration.hash, migration.folderMillis],
      );
      done.add(migration.hash);
      applied++;
    }
    return applied;
  });
}
