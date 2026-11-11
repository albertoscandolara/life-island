import {
  boolean,
  date,
  integer,
  jsonb,
  pgSchema,
  primaryKey,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import type {
  GoalArea,
  GoalsCoachOutput,
  LifeGoalStatus,
} from '@life-island/contracts';

export const goalsSchema = pgSchema('goals');

const createdAt = () =>
  timestamp('created_at', { withTimezone: true }).notNull().defaultNow();

/** Something you want to reach, and why. */
export const goals = goalsSchema.table('goals', {
  id: uuid('id').primaryKey().defaultRandom(),
  title: text('title').notNull(),
  area: text('area').$type<GoalArea>().notNull().default('other'),
  why: text('why'),
  measure: text('measure'),
  targetDate: date('target_date'),
  status: text('status').$type<LifeGoalStatus>().notNull().default('active'),
  createdAt: createdAt(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});
export type GoalRow = typeof goals.$inferSelect;

/** One concrete step towards a goal. */
export const goalSteps = goalsSchema.table('goal_steps', {
  id: uuid('id').primaryKey().defaultRandom(),
  goalId: uuid('goal_id')
    .notNull()
    .references(() => goals.id, { onDelete: 'cascade' }),
  title: text('title').notNull(),
  dueDate: date('due_date'),
  done: boolean('done').notNull().default(false),
  doneOn: date('done_on'),
  createdAt: createdAt(),
});
export type GoalStepRow = typeof goalSteps.$inferSelect;

/** Something you want to do a few times a week. */
export const habits = goalsSchema.table('habits', {
  id: uuid('id').primaryKey().defaultRandom(),
  title: text('title').notNull(),
  goalId: uuid('goal_id').references(() => goals.id, { onDelete: 'set null' }),
  perWeek: integer('per_week').notNull().default(7),
  active: boolean('active').notNull().default(true),
  createdAt: createdAt(),
});
export type HabitRow = typeof habits.$inferSelect;

/** A day a habit was done. */
export const habitChecks = goalsSchema.table(
  'habit_checks',
  {
    habitId: uuid('habit_id')
      .notNull()
      .references(() => habits.id, { onDelete: 'cascade' }),
    date: date('date').notNull(),
  },
  (t) => [primaryKey({ columns: [t.habitId, t.date] })],
);

/** The few lines you write at the end of a week. */
export const weeklyReviews = goalsSchema.table('weekly_reviews', {
  id: uuid('id').primaryKey().defaultRandom(),
  weekStart: date('week_start').notNull().unique(),
  mood: integer('mood'),
  wins: text('wins'),
  stuck: text('stuck'),
  next: text('next'),
  createdAt: createdAt(),
});
export type WeeklyReviewRow = typeof weeklyReviews.$inferSelect;

/** What the coach wrote, newest kept. */
export const coachAnswers = goalsSchema.table('coach_answers', {
  id: uuid('id').primaryKey().defaultRandom(),
  question: text('question'),
  output: jsonb('output').$type<GoalsCoachOutput>().notNull(),
  source: text('source').$type<'claude' | 'offline'>().notNull(),
  model: text('model'),
  createdAt: createdAt(),
});
export type CoachAnswerRow = typeof coachAnswers.$inferSelect;

/** svc-goals' copy of the settings it reads, kept by its settings.changed@1 consumer. */
export const settingsReplica = goalsSchema.table('settings_replica', {
  key: text('key').primaryKey(),
  value: jsonb('value').notNull(),
  changedAt: timestamp('changed_at', { withTimezone: true }).notNull(),
});
