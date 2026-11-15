import {
  date,
  integer,
  jsonb,
  numeric,
  pgSchema,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import type {
  DreamArea,
  DreamContextArea,
  DreamNextPace,
  DreamPace,
  DreamStatus,
  DreamStepKind,
  DreamStepStatus,
  DreamStepsOutput,
  DreamStretch,
} from '@life-island/contracts';

export const dreamsSchema = pgSchema('dreams');

const createdAt = () =>
  timestamp('created_at', { withTimezone: true }).notNull().defaultNow();

/** A dream, in your own words, with what you cannot put at risk. */
export const dreams = dreamsSchema.table('dreams', {
  id: uuid('id').primaryKey().defaultRandom(),
  title: text('title').notNull(),
  area: text('area').$type<DreamArea>().notNull().default('other'),
  story: text('story'),
  why: text('why'),
  today: text('today'),
  fears: text('fears'),
  mustKeep: text('must_keep'),
  pace: text('pace').$type<DreamPace>().notNull().default('gentle'),
  status: text('status').$type<DreamStatus>().notNull().default('dreaming'),
  contextAreas: jsonb('context_areas')
    .$type<DreamContextArea[]>()
    .notNull()
    .default([]),
  /** What Ovi said back when it asked its questions. */
  opening: text('opening'),
  createdAt: createdAt(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});
export type DreamRow = typeof dreams.$inferSelect;

/** A question asked before any step, and your answer. */
export const dreamQuestions = dreamsSchema.table('dream_questions', {
  id: uuid('id').primaryKey().defaultRandom(),
  dreamId: uuid('dream_id')
    .notNull()
    .references(() => dreams.id, { onDelete: 'cascade' }),
  question: text('question').notNull(),
  why: text('why'),
  answer: text('answer'),
  source: text('source').$type<'claude' | 'offline'>().notNull(),
  position: integer('position').notNull().default(0),
  createdAt: createdAt(),
});
export type DreamQuestionRow = typeof dreamQuestions.$inferSelect;

/** One small step: suggested, chosen by you, done or skipped. */
export const dreamSteps = dreamsSchema.table('dream_steps', {
  id: uuid('id').primaryKey().defaultRandom(),
  dreamId: uuid('dream_id')
    .notNull()
    .references(() => dreams.id, { onDelete: 'cascade' }),
  title: text('title').notNull(),
  kind: text('kind').$type<DreamStepKind>().notNull().default('reflect'),
  why: text('why'),
  minutes: integer('minutes'),
  costEuro: numeric('cost_euro', { precision: 12, scale: 2, mode: 'number' }),
  cost: text('cost'),
  stretch: text('stretch').$type<DreamStretch>().notNull().default('tiny'),
  undo: text('undo'),
  smaller: text('smaller'),
  status: text('status').$type<DreamStepStatus>().notNull().default('chosen'),
  dueDate: date('due_date'),
  doneOn: date('done_on'),
  source: text('source')
    .$type<'claude' | 'offline' | 'you'>()
    .notNull()
    .default('you'),
  createdAt: createdAt(),
});
export type DreamStepRow = typeof dreamSteps.$inferSelect;

/** How a step felt, and the pace you want next. */
export const dreamCheckIns = dreamsSchema.table('dream_check_ins', {
  id: uuid('id').primaryKey().defaultRandom(),
  dreamId: uuid('dream_id')
    .notNull()
    .references(() => dreams.id, { onDelete: 'cascade' }),
  stepId: uuid('step_id').references(() => dreamSteps.id, {
    onDelete: 'set null',
  }),
  outcome: text('outcome').$type<'done' | 'skipped'>(),
  feeling: integer('feeling').notNull(),
  note: text('note'),
  nextPace: text('next_pace').$type<DreamNextPace>().notNull().default('same'),
  createdAt: createdAt(),
});
export type DreamCheckInRow = typeof dreamCheckIns.$inferSelect;

/** The reflection and the "not yet" moves of each round of suggestions, newest kept. */
export const dreamGuidance = dreamsSchema.table('dream_guidance', {
  id: uuid('id').primaryKey().defaultRandom(),
  dreamId: uuid('dream_id')
    .notNull()
    .references(() => dreams.id, { onDelete: 'cascade' }),
  reflection: text('reflection').notNull(),
  notYet: jsonb('not_yet').$type<DreamStepsOutput['notYet']>().notNull(),
  care: text('care'),
  source: text('source').$type<'claude' | 'offline'>().notNull(),
  model: text('model'),
  createdAt: createdAt(),
});
export type DreamGuidanceRow = typeof dreamGuidance.$inferSelect;

/** svc-dreams' copy of the settings it reads, kept by its settings.changed@1 consumer. */
export const settingsReplica = dreamsSchema.table('settings_replica', {
  key: text('key').primaryKey(),
  value: jsonb('value').notNull(),
  changedAt: timestamp('changed_at', { withTimezone: true }).notNull(),
});
