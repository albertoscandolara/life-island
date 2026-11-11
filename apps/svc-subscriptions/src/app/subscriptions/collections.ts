import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type { RecordCollection } from '@life-island/be-nest';
import { subscriptionRequestSchema } from '@life-island/contracts';
import { contracts } from '../db/schema.js';

export const RECORDS = Symbol('SubscriptionsRecords');

/** The contracts. A change of cost goes through SubscriptionsController, to keep its history. */
export function collections(_db: NodePgDatabase): RecordCollection[] {
  return [
    {
      name: 'items',
      label: 'Contract',
      table: contracts,
      request: subscriptionRequestSchema,
    },
  ];
}
