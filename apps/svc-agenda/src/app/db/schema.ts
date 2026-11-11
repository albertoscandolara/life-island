import {
  boolean,
  date,
  jsonb,
  pgSchema,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import type {
  AgendaBriefOutput,
  AgendaCategory,
  AgendaRepeat,
} from '@life-island/contracts';

export const agenda = pgSchema('agenda');

const createdAt = () =>
  timestamp('created_at', { withTimezone: true }).notNull().defaultNow();

/** Your own dated items: a birthday, a call to make, the boiler check. */
export const agendaItems = agenda.table('agenda_items', {
  id: uuid('id').primaryKey().defaultRandom(),
  title: text('title').notNull(),
  date: date('date').notNull(),
  time: text('time'),
  repeat: text('repeat').$type<AgendaRepeat>().notNull().default('none'),
  category: text('category')
    .$type<AgendaCategory>()
    .notNull()
    .default('personal'),
  notes: text('notes'),
  done: boolean('done').notNull().default(false),
  createdAt: createdAt(),
});
export type AgendaItemRow = typeof agendaItems.$inferSelect;

/**
 * The dates you marked as handled: an area's deadline, one occurrence of a
 * repeating item, or a calendar date of one year, by their agenda key.
 */
export const handledEntries = agenda.table('handled_entries', {
  key: text('key').primaryKey(),
  handledAt: timestamp('handled_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/** The briefs the week brief wrote, newest kept. */
export const weekBriefs = agenda.table('week_briefs', {
  id: uuid('id').primaryKey().defaultRandom(),
  question: text('question'),
  output: jsonb('output').$type<AgendaBriefOutput>().notNull(),
  source: text('source').$type<'claude' | 'offline'>().notNull(),
  model: text('model'),
  createdAt: createdAt(),
});
export type WeekBriefRow = typeof weekBriefs.$inferSelect;

/**
 * svc-agenda's copy of the settings it reads (the AI switches, the Italian
 * calendar), kept by its consumer of settings.changed@1.
 */
export const settingsReplica = agenda.table('settings_replica', {
  key: text('key').primaryKey(),
  value: jsonb('value').notNull(),
  changedAt: timestamp('changed_at', { withTimezone: true }).notNull(),
});
