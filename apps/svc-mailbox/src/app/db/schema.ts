import {
  date,
  jsonb,
  numeric,
  pgSchema,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import type {
  LetterExplanationDto,
  LetterKind,
  LetterStatus,
} from '@life-island/contracts';

export const mailbox = pgSchema('mailbox');

/** An official letter: from the Agenzia delle Entrate, INPS, the Comune, a bank. */
export const letters = mailbox.table('letters', {
  id: uuid('id').primaryKey().defaultRandom(),
  receivedOn: date('received_on').notNull(),
  sender: text('sender').notNull(),
  kind: text('kind').$type<LetterKind>().notNull().default('other'),
  subject: text('subject').notNull(),
  text: text('text'),
  reference: text('reference'),
  amount: numeric('amount', { precision: 12, scale: 2, mode: 'number' }),
  dueOn: date('due_on'),
  status: text('status').$type<LetterStatus>().notNull().default('todo'),
  action: text('action'),
  notes: text('notes'),
  /** What the explainer said about it, the last time it was asked. */
  explanation: jsonb('explanation').$type<LetterExplanationDto>(),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});
export type LetterRow = typeof letters.$inferSelect;

/** svc-mailbox's copy of the settings it reads, kept by its settings.changed@1 consumer. */
export const settingsReplica = mailbox.table('settings_replica', {
  key: text('key').primaryKey(),
  value: jsonb('value').notNull(),
  changedAt: timestamp('changed_at', { withTimezone: true }).notNull(),
});
