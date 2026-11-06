import { createServiceDb, type ServiceDb } from '@life-island/be-common';
import { PARSE_QUEUE_ID } from '@life-island/ingestion-db';
import type { WorkerConfig } from './config.js';
import type { ParseService } from './parse.service.js';
import { ParseScheduler } from './scheduler.js';

// Needs Postgres: `npm run infra:up`, then `npm run test:integration`.
const configured = !!process.env['INGESTION_DATABASE_URL'];

describe.skipIf(!configured)('ParseScheduler: Parse now', () => {
  let svc: ServiceDb;
  let other: ServiceDb;
  let scheduler: ParseScheduler;
  let runs = 0;

  beforeAll(async () => {
    const url = process.env['INGESTION_DATABASE_URL'] as string;
    svc = createServiceDb({ connectionString: url, schema: 'ingestion' });
    other = createServiceDb({ connectionString: url, schema: 'ingestion' });
    const queue = {
      setNextScheduledRun: async () => undefined,
      wasInterrupted: async () => false,
      get: async () => {
        const { rows } = await svc.pool.query<{
          status: string;
          runRequestedAt: Date | null;
          runStartedAt: Date | null;
        }>(
          `select status, run_requested_at as "runRequestedAt",
                  run_started_at as "runStartedAt"
             from ingestion.parse_queue where id = $1`,
          [PARSE_QUEUE_ID],
        );
        return (
          rows[0] ?? {
            status: 'IDLE',
            runRequestedAt: null,
            runStartedAt: null,
          }
        );
      },
      isPaused: () => false,
    };
    const parse = {
      queue,
      runOnce: async () => {
        runs++;
        await svc.pool.query(
          `update ingestion.parse_queue set run_started_at = now() where id = $1`,
          [PARSE_QUEUE_ID],
        );
        return {};
      },
      requestStop: () => undefined,
    } as unknown as ParseService;
    scheduler = new ParseScheduler(
      parse,
      { schedule: '0 6 * * *', runOnStart: false } as WorkerConfig,
      svc,
    );
    scheduler.pollMs = 200;
    await scheduler.onApplicationBootstrap();
  });

  afterAll(async () => {
    await scheduler?.onApplicationShutdown();
    await svc?.close();
    await other?.close();
  });

  it('starts a run when svc-ingestion asks for one', async () => {
    // What svc-ingestion's requestRun does, from another connection.
    const client = await other.pool.connect();
    try {
      await client.query('begin');
      await client.query(
        `insert into ingestion.parse_queue (id, run_requested_at) values ($1, now())
         on conflict (id) do update set run_requested_at = now(), updated_at = now()`,
        [PARSE_QUEUE_ID],
      );
      await client.query(`select pg_notify('parse_requested', '')`);
      await client.query('commit');
    } finally {
      client.release();
    }
    await vi.waitFor(() => expect(runs).toBe(1), { timeout: 5000 });
  });

  it('still starts it when the notification never arrives', async () => {
    const before = runs;
    // The request alone, as if its NOTIFY were lost on the way.
    await other.pool.query(
      `update ingestion.parse_queue set run_requested_at = now()
        where id = $1`,
      [PARSE_QUEUE_ID],
    );
    await vi.waitFor(() => expect(runs).toBe(before + 1), { timeout: 5000 });
    // Once it ran, the same request does not start another.
    await new Promise((resolve) => setTimeout(resolve, 2000));
    expect(runs).toBe(before + 1);
  });
});
