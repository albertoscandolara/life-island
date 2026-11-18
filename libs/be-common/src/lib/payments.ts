import {
  PAYMENT_LINKED_EVENT,
  PAYMENT_UNLINKED_EVENT,
  payableModule,
  paymentLinkedV1Schema,
  paymentUnlinkedV1Schema,
  type EventEnvelope,
} from '@life-island/contracts';
import type pg from 'pg';
import { assertSchemaName } from './schema-name.js';

/*
 * The other end of Money matching (docs/guides/money-matching.md): an area
 * keeps the bank payments you confirmed for its items in its own
 * `<schema>.payments` table, the same shape everywhere:
 *
 *   link_id uuid primary key, payable_key text, amount numeric,
 *   paid_on date null, account_name text null, description text null,
 *   unlinked_at timestamptz null, created_at timestamptz
 *
 * One row per link. An undone link keeps its row with `unlinked_at` set, so
 * a redelivered event, or the undo arriving before the link, never brings a
 * payment back.
 */

/** The events an area with payables listens to. */
export const PAYMENT_EVENTS = [PAYMENT_LINKED_EVENT, PAYMENT_UNLINKED_EVENT];

/**
 * Applies money.payment_linked@1 and money.payment_unlinked@1 to the area's
 * payments table; events about another area's items are ignored. Run it
 * inside startEventConsumer, which makes it idempotent per event.
 */
export function paymentEventHandler(schema: string, module: string) {
  const table = `${assertSchemaName(schema)}.payments`;
  return async (event: EventEnvelope, client: pg.PoolClient): Promise<void> => {
    if (event.type === PAYMENT_LINKED_EVENT) {
      const link = paymentLinkedV1Schema.parse(event.payload);
      if (payableModule(link.payableKey) !== module) return;
      await client.query(
        `insert into ${table}
           (link_id, payable_key, amount, paid_on, account_name, description)
         values ($1, $2, $3, $4, $5, $6)
         on conflict (link_id) do nothing`,
        [
          link.linkId,
          link.payableKey,
          link.amount,
          link.date,
          link.accountName,
          link.description,
        ],
      );
    } else if (event.type === PAYMENT_UNLINKED_EVENT) {
      const undo = paymentUnlinkedV1Schema.parse(event.payload);
      if (payableModule(undo.payableKey) !== module) return;
      await client.query(
        `insert into ${table} (link_id, payable_key, amount, unlinked_at)
         values ($1, $2, 0, $3)
         on conflict (link_id) do update set unlinked_at = excluded.unlinked_at`,
        [undo.linkId, undo.payableKey, undo.unlinkedAt],
      );
    }
  };
}
