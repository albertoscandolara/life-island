import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { assertSchemaName } from './schema-name.js';

export interface ServiceDbOptions {
  /** Connection string for the service's own login role. */
  connectionString: string;
  /** The schema this service owns; becomes the connection's search_path. */
  schema: string;
  /** Most connections this pool opens; defaults to DB_POOL_MAX or 3. */
  max?: number;
}

/**
 * Every service has its own pool and they all share one Postgres, whose default
 * limit is 100 connections. A pool only grows when a request runs queries in
 * parallel (a Promise.all over several tables), and the Agenda reads every area
 * at once, so each pool reaches its `max` together. At 10 per pool, about twenty
 * services asked for 200 and the last ones in were refused ("too many clients").
 * Three per service keeps the whole island under the limit; extra parallel
 * queries wait in the pool for a free connection instead of failing.
 */
export const DEFAULT_POOL_MAX = 3;

function poolMax(): number {
  const fromEnv = Number(process.env['DB_POOL_MAX']);
  return Number.isInteger(fromEnv) && fromEnv > 0 ? fromEnv : DEFAULT_POOL_MAX;
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
    max: options.max ?? poolMax(),
    options: `-c search_path=${schema}`,
    // TCP keepalive: a connection that sits idle (a LISTEN, a quiet pool) is
    // not dropped unnoticed by Docker's or the OS's NAT, and a dead one errors.
    keepAlive: true,
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
