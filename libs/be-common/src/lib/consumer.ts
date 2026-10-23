import {
  eventEnvelopeSchema,
  subjectFor,
  type EventEnvelope,
} from '@life-island/contracts';
import {
  AckPolicy,
  jetstream,
  jetstreamManager,
  type ConsumerMessages,
} from '@nats-io/jetstream';
import type { NatsConnection } from '@nats-io/transport-node';
import type pg from 'pg';
import { withTransaction } from './db.js';
import { EVENTS_STREAM } from './nats.js';
import { assertSchemaName } from './schema-name.js';

/**
 * Runs `handler` at most once per event id. The `processed_events` insert and
 * the handler's writes share one transaction, so a redelivered event is a no-op.
 * Returns false when the event had already been processed.
 */
export async function processOnce(
  pool: pg.Pool,
  schema: string,
  eventId: string,
  handler: (client: pg.PoolClient) => Promise<void>,
): Promise<boolean> {
  const safeSchema = assertSchemaName(schema);
  return withTransaction(pool, async (client) => {
    const { rowCount } = await client.query(
      `insert into ${safeSchema}.processed_events (event_id) values ($1) on conflict (event_id) do nothing`,
      [eventId],
    );
    if (rowCount === 0) return false;
    await handler(client);
    return true;
  });
}

export interface EventConsumerOptions {
  pool: pg.Pool;
  nats: NatsConnection;
  schema: string;
  /** Durable consumer name, unique per service and purpose, e.g. `grocery-record-approved`. */
  durableName: string;
  /** Versioned event types to receive, e.g. `['record.approved@1']`. */
  eventTypes: string[];
  handle: (event: EventEnvelope, client: pg.PoolClient) => Promise<void>;
  onError?: (error: unknown, subject: string) => void;
}

/** Subscribes a durable JetStream consumer and handles each event idempotently. */
export async function startEventConsumer(
  options: EventConsumerOptions,
): Promise<ConsumerMessages> {
  const jsm = await jetstreamManager(options.nats);
  await jsm.consumers.add(EVENTS_STREAM, {
    durable_name: options.durableName,
    ack_policy: AckPolicy.Explicit,
    filter_subjects: options.eventTypes.map(subjectFor),
  });
  const consumer = await jetstream(options.nats).consumers.get(
    EVENTS_STREAM,
    options.durableName,
  );
  const messages = await consumer.consume();

  void (async () => {
    for await (const message of messages) {
      try {
        const event = eventEnvelopeSchema.parse(
          message.json(),
        ) as EventEnvelope;
        await processOnce(options.pool, options.schema, event.id, (client) =>
          options.handle(event, client),
        );
        message.ack();
      } catch (error) {
        options.onError?.(error, message.subject);
        message.nak();
      }
    }
  })();

  return messages;
}
