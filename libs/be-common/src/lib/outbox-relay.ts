import { subjectFor, type EventEnvelope } from '@life-island/contracts';
import { jetstream, type JetStreamClient } from '@nats-io/jetstream';
import type { NatsConnection } from '@nats-io/transport-node';
import type pg from 'pg';
import { withTransaction } from './db.js';
import { assertSchemaName } from './schema-name.js';

export interface OutboxRelayOptions {
  pool: pg.Pool;
  nats: NatsConnection;
  schema: string;
  /** Name stamped on every envelope as `source`; defaults to the schema. */
  source?: string;
  batchSize?: number;
  pollIntervalMs?: number;
  onError?: (error: unknown) => void;
}

interface OutboxRow {
  id: string;
  event_type: string;
  payload: unknown;
  created_at: Date;
}

/**
 * Publishes unpublished outbox rows to JetStream, oldest first.
 *
 * Rows are locked with `for update skip locked`, so several relay replicas can
 * run side by side. The outbox id is the JetStream message id: if the relay
 * crashes after publishing but before marking the row, the retry is deduplicated.
 */
export class OutboxRelay {
  private readonly js: JetStreamClient;
  private readonly schema: string;
  private timer?: NodeJS.Timeout;
  private running?: Promise<void>;

  constructor(private readonly options: OutboxRelayOptions) {
    this.schema = assertSchemaName(options.schema);
    this.js = jetstream(options.nats);
  }

  /** Publishes one batch and returns how many rows were published. */
  async publishBatch(): Promise<number> {
    const { pool, batchSize = 100 } = this.options;
    return withTransaction(pool, async (client) => {
      const { rows } = await client.query<OutboxRow>(
        `select id, event_type, payload, created_at
           from ${this.schema}.outbox
          where published_at is null
          order by created_at
          limit $1
          for update skip locked`,
        [batchSize],
      );
      for (const row of rows) {
        const envelope: EventEnvelope = {
          id: row.id,
          type: row.event_type,
          source: this.options.source ?? this.schema,
          occurredAt: row.created_at.toISOString(),
          payload: row.payload,
        };
        await this.js.publish(
          subjectFor(row.event_type),
          JSON.stringify(envelope),
          { msgID: row.id },
        );
      }
      if (rows.length > 0) {
        await client.query(
          `update ${this.schema}.outbox set published_at = now() where id = any($1::uuid[])`,
          [rows.map((row) => row.id)],
        );
      }
      return rows.length;
    });
  }

  start(): void {
    if (this.timer) return;
    const interval = this.options.pollIntervalMs ?? 500;
    const tick = async () => {
      try {
        // Drain full batches back to back, then wait for the next poll.
        while ((await this.publishBatch()) === (this.options.batchSize ?? 100));
      } catch (error) {
        this.options.onError?.(error);
      }
      if (this.timer)
        this.timer = setTimeout(() => (this.running = tick()), interval);
    };
    this.timer = setTimeout(() => (this.running = tick()), 0);
  }

  async stop(): Promise<void> {
    clearTimeout(this.timer);
    this.timer = undefined;
    await this.running;
  }
}
