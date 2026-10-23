import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { assertSchemaName } from './schema-name.js';

export interface ServiceDbOptions {
  /** Connection string for the service's own login role. */
  connectionString: string;
  /** The schema this service owns; becomes the connection's search_path. */
  schema: string;
  max?: number;
}

export interface ServiceDb {
  pool: pg.Pool;
  db: NodePgDatabase;
  schema: string;
  close(): Promise<void>;
}

/** One pool per service, pinned to the service's own schema. */
export function createServiceDb(options: ServiceDbOptions): ServiceDb {
  const schema = assertSchemaName(options.schema);
  const pool = new pg.Pool({
    connectionString: options.connectionString,
    max: options.max ?? 10,
    options: `-c search_path=${schema}`,
  });
  return {
    pool,
    db: drizzle(pool),
    schema,
    close: () => pool.end(),
  };
}

/** Runs `fn` inside a transaction, committing on success and rolling back on any error. */
export async function withTransaction<T>(
  pool: pg.Pool,
  fn: (client: pg.PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('begin');
    const result = await fn(client);
    await client.query('commit');
    return result;
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }
}
