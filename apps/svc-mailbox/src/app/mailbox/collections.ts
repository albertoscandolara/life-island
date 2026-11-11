import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type { RecordCollection } from '@life-island/be-nest';
import { guessLetterKind, letterRequestSchema, type LetterRequest } from '@life-island/contracts';
import { letters } from '../db/schema.js';

export const RECORDS = Symbol('MailboxRecords');

/** The letters. Without a kind, it is guessed from the sender, subject and text. */
export function collections(_db: NodePgDatabase): RecordCollection[] {
  return [
    {
      name: 'letters',
      label: 'Letter',
      table: letters,
      request: letterRequestSchema,
      toValues: (request: Partial<LetterRequest>) =>
        request.kind || request.subject === undefined
          ? request
          : {
              ...request,
              kind: guessLetterKind(`${request.sender ?? ''} ${request.subject} ${request.text ?? ''}`),
            },
    },
  ];
}
