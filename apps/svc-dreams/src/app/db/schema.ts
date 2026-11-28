import {
  boolean,
  date,
  integer,
  jsonb,
  numeric,
  pgSchema,
  primaryKey,
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
  /** How you will know it is reached. */
  measure: text('measure'),
  targetDate: date('target_date'),
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

/** A milestone of the path to a dream: what is true once you reach it. */
export const dreamMilestones = dreamsSchema.table('dream_milestones', {
  id: uuid('id').primaryKey().defaultRandom(),
  dreamId: uuid('dream_id')
    .notNull()
    .references(() => dreams.id, { onDelete: 'cascade' }),
  title: text('title').notNull(),
  why: text('why'),
  position: integer('position').notNull().default(0),
  reachedOn: date('reached_on'),
  source: text('source')
    .$type<'claude' | 'offline' | 'you'>()
    .notNull()
    .default('you'),
  createdAt: createdAt(),
});
export type DreamMilestoneRow = typeof dreamMilestones.$inferSelect;

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
  milestoneId: uuid('milestone_id').references(() => dreamMilestones.id, {
    onDelete: 'set null',
  }),
  /** When and where you will do it. */
  cue: text('cue'),
  /** "If …, then I will …". */
  ifThen: text('if_then'),
  /** How hard you expect it to be, 1 to 5. */
  expectedHard: integer('expected_hard'),
  source: text('source')
    .$type<'claude' | 'offline' | 'you' | 'goals'>()
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
  /** How hard it really was, 1 to 5. */
  actualHard: integer('actual_hard'),
  /** What it showed you: proof that you can. */
  learned: text('learned'),
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

/** Something you repeat a few days a week, for a dream or for its own sake. */
export const habits = dreamsSchema.table('habits', {
  id: uuid('id').primaryKey().defaultRandom(),
  title: text('title').notNull(),
  dreamId: uuid('dream_id').references(() => dreams.id, {
    onDelete: 'set null',
  }),
  perWeek: integer('per_week').notNull().default(7),
  active: boolean('active').notNull().default(true),
  createdAt: createdAt(),
});
export type HabitRow = typeof habits.$inferSelect;

/** A day a habit was done. */
export const habitChecks = dreamsSchema.table(
  'habit_checks',
  {
    habitId: uuid('habit_id')
      .notNull()
      .references(() => habits.id, { onDelete: 'cascade' }),
    date: date('date').notNull(),
  },
  (t) => [primaryKey({ columns: [t.habitId, t.date] })],
);

/** The few lines you write at the end of a week, about every dream at once. */
export const weeklyReviews = dreamsSchema.table('weekly_reviews', {
  id: uuid('id').primaryKey().defaultRandom(),
  weekStart: date('week_start').notNull().unique(),
  mood: integer('mood'),
  wins: text('wins'),
  stuck: text('stuck'),
  next: text('next'),
  createdAt: createdAt(),
});
export type WeeklyReviewRow = typeof weeklyReviews.$inferSelect;

/** svc-dreams' copy of the settings it reads, kept by its settings.changed@1 consumer. */
export const settingsReplica = dreamsSchema.table('settings_replica', {
  key: text('key').primaryKey(),
  value: jsonb('value').notNull(),
  changedAt: timestamp('changed_at', { withTimezone: true }).notNull(),
});
