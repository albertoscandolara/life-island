import {
  boolean,
  date,
  doublePrecision,
  integer,
  jsonb,
  numeric,
  pgSchema,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import type { ResultsExplainerOutput, VisitKind } from '@life-island/contracts';

export const health = pgSchema('health');

const createdAt = () =>
  timestamp('created_at', { withTimezone: true }).notNull().defaultNow();

/** A visit, an exam or a trip to the emergency room. */
export const visits = health.table('visits', {
  id: uuid('id').primaryKey().defaultRandom(),
  date: date('date').notNull(),
  person: text('person').notNull(),
  kind: text('kind').$type<VisitKind>().notNull().default('gp'),
  doctor: text('doctor'),
  reason: text('reason'),
  outcome: text('outcome'),
  cost: numeric('cost', { precision: 10, scale: 2, mode: 'number' }),
  deductible: boolean('deductible').notNull().default(true),
  followUpOn: date('follow_up_on'),
  createdAt: createdAt(),
});

/** A medicine someone takes, and when the box runs out. */
export const medicines = health.table('medicines', {
  id: uuid('id').primaryKey().defaultRandom(),
  person: text('person').notNull(),
  name: text('name').notNull(),
  dose: text('dose'),
  schedule: text('schedule'),
  startOn: date('start_on'),
  endOn: date('end_on'),
  refillOn: date('refill_on'),
  active: boolean('active').notNull().default(true),
  notes: text('notes'),
  createdAt: createdAt(),
});

/** One value of one test (glucose, cholesterol…) on one day. */
export const testResults = health.table('test_results', {
  id: uuid('id').primaryKey().defaultRandom(),
  date: date('date').notNull(),
  person: text('person').notNull(),
  test: text('test').notNull(),
  value: doublePrecision('value').notNull(),
  unit: text('unit'),
  low: doublePrecision('low'),
  high: doublePrecision('high'),
  notes: text('notes'),
  createdAt: createdAt(),
});
export type TestResultRow = typeof testResults.$inferSelect;

export const vaccinations = health.table('vaccinations', {
  id: uuid('id').primaryKey().defaultRandom(),
  person: text('person').notNull(),
  name: text('name').notNull(),
  date: date('date').notNull(),
  nextDueOn: date('next_due_on'),
  notes: text('notes'),
  createdAt: createdAt(),
});

/** A screening to repeat every few months. */
export const checkups = health.table('checkups', {
  id: uuid('id').primaryKey().defaultRandom(),
  person: text('person').notNull(),
  name: text('name').notNull(),
  everyMonths: integer('every_months').notNull(),
  lastDoneOn: date('last_done_on'),
  notes: text('notes'),
  createdAt: createdAt(),
});
export type CheckupRow = typeof checkups.$inferSelect;

/** What the explainer wrote, newest kept. */
export const explanations = health.table('explanations', {
  id: uuid('id').primaryKey().defaultRandom(),
  person: text('person'),
  question: text('question'),
  output: jsonb('output').$type<ResultsExplainerOutput>().notNull(),
  source: text('source').$type<'claude' | 'offline'>().notNull(),
  model: text('model'),
  createdAt: createdAt(),
});
export type ExplanationRow = typeof explanations.$inferSelect;

/** svc-health's copy of the settings it reads, kept by its settings.changed@1 consumer. */
export const settingsReplica = health.table('settings_replica', {
  key: text('key').primaryKey(),
  value: jsonb('value').notNull(),
  changedAt: timestamp('changed_at', { withTimezone: true }).notNull(),
});
