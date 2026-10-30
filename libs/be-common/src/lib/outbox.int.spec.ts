import { jetstreamManager } from '@nats-io/jetstream';
import type { NatsConnection } from '@nats-io/transport-node';
import { randomUUID } from 'node:crypto';
import { processOnce, startEventConsumer } from './consumer.js';
import { createServiceDb, withTransaction, type ServiceDb } from './db.js';
import { connectNats, ensureEventsStream, EVENTS_STREAM } from './nats.js';
import { enqueueEvent } from './outbox.js';
import { OutboxRelay } from './outbox-relay.js';

// Needs the compose stack: `npm run infra:up`, then `npm run test:integration`.
const databaseUrl = process.env['GROCERY_DATABASE_URL'];
const natsUrl = process.env['NATS_URL'];

describe.skipIf(!databaseUrl || !natsUrl)(
  'outbox → NATS → idempotent consumer',
  () => {
    let svc: ServiceDb;
    let nc: NatsConnection;

    beforeAll(async () => {
      svc = createServiceDb({
        connectionString: databaseUrl as string,
        schema: 'grocery',
      });
      nc = await connectNats(natsUrl as string, 'be-common-int-test');
      await ensureEventsStream(nc);
      await svc.pool.query(
        'create table if not exists int_test_items (id uuid primary key, source_event uuid)',
      );
      await svc.pool.query('truncate int_test_items');
      // Earlier runs may have left unpublished rows; mark them so this run starts clean.
      await svc.pool.query(
        'update outbox set published_at = now() where published_at is null',
      );
    });

    afterAll(async () => {
      await svc.pool.query('drop table if exists int_test_items');
      await nc.drain();
      await svc.close();
    });

    it('rolls back the outbox row together with the domain change', async () => {
      const before = await svc.pool.query(
        'select count(*)::int as n from outbox',
      );
      await expect(
        withTransaction(svc.pool, async (client) => {
          await enqueueEvent(client, 'grocery', {
            type: 'test.rolled_back@1',
            payload: {},
          });
          throw new Error('domain write failed');
        }),
      ).rejects.toThrow('domain write failed');
      const after = await svc.pool.query(
        'select count(*)::int as n from outbox',
      );
      expect(after.rows[0].n).toBe(before.rows[0].n);
    });

    it('publishes each outbox row once and the consumer applies it once', async () => {
      const durableName = `int-test-${randomUUID().slice(0, 8)}`;
      const eventType = `test.item_created_${durableName.slice(-8)}@1`;
      const received: string[] = [];

      const messages = await startEventConsumer({
        pool: svc.pool,
        nats: nc,
        schema: 'grocery',
        durableName,
        eventTypes: [eventType],
        handle: async (event, client) => {
          received.push(event.id);
          await client.query(
            'insert into int_test_items (id, source_event) values ($1, $2)',
            [randomUUID(), event.id],
          );
        },
      });

      const ids = await withTransaction(svc.pool, async (client) => {
        const created: string[] = [];
        for (const n of [1, 2, 3])
          created.push(
            await enqueueEvent(client, 'grocery', {
              type: eventType,
              payload: { n },
            }),
          );
        return created;
      });

      const relay = new OutboxRelay({
        pool: svc.pool,
        nats: nc,
        schema: 'grocery',
      });
      expect(await relay.publishBatch()).toBe(3);
      expect(await relay.publishBatch()).toBe(0);

      await vi.waitFor(() => expect(received).toHaveLength(3), {
        timeout: 5000,
      });

      // A redelivered event (same id) must not apply twice.
      const applied = await processOnce(
        svc.pool,
        'grocery',
        ids[0],
        async () => {
          throw new Error('handler must not run for a processed event');
        },
      );
      expect(applied).toBe(false);

      const { rows } = await svc.pool.query(
        'select count(*)::int as n from int_test_items',
      );
      expect(rows[0].n).toBe(3);

      await messages.close();
      await (
        await jetstreamManager(nc)
      ).consumers.delete(EVENTS_STREAM, durableName);
    });

    it('restarts a durable consumer that now handles one more event type', async () => {
      const durableName = `int-test-${randomUUID().slice(0, 8)}`;
      const first = `test.first_${durableName.slice(-8)}@1`;
      const second = `test.second_${durableName.slice(-8)}@1`;
      const consumer = (eventTypes: string[], received: string[]) =>
        startEventConsumer({
          pool: svc.pool,
          nats: nc,
          schema: 'grocery',
          durableName,
          eventTypes,
          handle: async (event) => {
            received.push(event.type);
          },
        });

      await (await consumer([first], [])).close();
      // The same durable with another subject list used to fail with
      // "consumer already exists"; now its filter is updated.
      const received: string[] = [];
      const messages = await consumer([first, second], received);
      await withTransaction(svc.pool, (client) =>
        enqueueEvent(client, 'grocery', { type: second, payload: {} }),
      );
      await new OutboxRelay({
        pool: svc.pool,
        nats: nc,
        schema: 'grocery',
      }).publishBatch();
      await vi.waitFor(() => expect(received).toEqual([second]), {
        timeout: 5000,
      });

      await messages.close();
      await (
        await jetstreamManager(nc)
      ).consumers.delete(EVENTS_STREAM, durableName);
    });

    it('lets JetStream drop a republished outbox row', async () => {
      const eventType = 'test.dedupe@1';
      const id = await withTransaction(svc.pool, (client) =>
        enqueueEvent(client, 'grocery', { type: eventType, payload: {} }),
      );
      const relay = new OutboxRelay({
        pool: svc.pool,
        nats: nc,
        schema: 'grocery',
      });
      await relay.publishBatch();

      // Simulate a crash between publish and the published_at update.
      await svc.pool.query(
        'update outbox set published_at = null where id = $1',
        [id],
      );
      const jsm = await jetstreamManager(nc);
      const before = (await jsm.streams.info(EVENTS_STREAM)).state.messages;
      await relay.publishBatch();
      const after = (await jsm.streams.info(EVENTS_STREAM)).state.messages;
      expect(after).toBe(before);
    });
  },
);
