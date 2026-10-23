import { contractNameSchema } from '@life-island/contracts';
import type pg from 'pg';
import { assertSchemaName } from './schema-name.js';

export interface OutboxEvent {
  /** Versioned contract name, e.g. `grocery.receipt@1`. */
  type: string;
  payload: unknown;
}

/**
 * Writes an event to the service's outbox. Call it with the same client as the
 * domain change so both commit or roll back together.
 */
export async function enqueueEvent(
  client: pg.ClientBase,
  schema: string,
  event: OutboxEvent,
): Promise<string> {
  const type = contractNameSchema.parse(event.type);
  const { rows } = await client.query<{ id: string }>(
    `insert into ${assertSchemaName(schema)}.outbox (event_type, payload) values ($1, $2) returning id`,
    [type, JSON.stringify(event.payload)],
  );
  return rows[0].id;
}
