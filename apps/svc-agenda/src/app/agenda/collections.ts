import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type { RecordCollection } from '@life-island/be-nest';
import { agendaItemRequestSchema } from '@life-island/contracts';
import { agendaItems } from '../db/schema.js';

export const RECORDS = Symbol('AgendaRecords');

/** Agenda's plain records: your own items. */
export function collections(_db: NodePgDatabase): RecordCollection[] {
  return [
    {
      name: 'items',
      label: 'Item',
      table: agendaItems,
      request: agendaItemRequestSchema,
    },
  ];
}
