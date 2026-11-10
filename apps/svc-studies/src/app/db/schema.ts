import {
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgSchema,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import type {
  BillingPeriod,
  CertificationStatus,
  CourseStatus,
  PathStatus,
  StepStatus,
  StudyPlanOutput,
  StudyTopic,
  TrainingPlatformPlan,
  TrainingPlatformStatus,
} from '@life-island/contracts';

export const studies = pgSchema('studies');

const createdAt = () =>
  timestamp('created_at', { withTimezone: true }).notNull().defaultNow();

/** The training platforms you use (Udemy, Anthropic Academy…), with what they cost. */
export const trainingPlatforms = studies.table('training_platforms', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  url: text('url').notNull(),
  account: text('account'),
  plan: text('plan').$type<TrainingPlatformPlan>().notNull().default('free'),
  status: text('status')
    .$type<TrainingPlatformStatus>()
    .notNull()
    .default('active'),
  price: numeric('price', { precision: 10, scale: 2, mode: 'number' }),
  billingPeriod: text('billing_period').$type<BillingPeriod>(),
  renewsOn: date('renews_on'),
  topics: text('topics').array().$type<StudyTopic[]>().notNull().default([]),
  notes: text('notes'),
  lastOpenedAt: timestamp('last_opened_at', { withTimezone: true }),
  createdAt: createdAt(),
});
export type TrainingPlatformRow = typeof trainingPlatforms.$inferSelect;

/** The courses you take, on a platform or anywhere else. */
export const courses = studies.table('courses', {
  id: uuid('id').primaryKey().defaultRandom(),
  title: text('title').notNull(),
  platformId: uuid('platform_id').references(() => trainingPlatforms.id, {
    onDelete: 'set null',
  }),
  url: text('url'),
  topic: text('topic').$type<StudyTopic>().notNull().default('other'),
  stepId: text('step_id'),
  status: text('status').$type<CourseStatus>().notNull().default('planned'),
  progress: integer('progress').notNull().default(0),
  hours: numeric('hours', { precision: 7, scale: 1, mode: 'number' }),
  cost: numeric('cost', { precision: 10, scale: 2, mode: 'number' }),
  startedOn: date('started_on'),
  completedOn: date('completed_on'),
  certificateUrl: text('certificate_url'),
  notes: text('notes'),
  createdAt: createdAt(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});
export type CourseRow = typeof courses.$inferSelect;

/** Exams and certifications: planned, booked, passed, and when they expire. */
export const certifications = studies.table('certifications', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  provider: text('provider'),
  topic: text('topic').$type<StudyTopic>().notNull().default('other'),
  status: text('status')
    .$type<CertificationStatus>()
    .notNull()
    .default('planned'),
  examOn: date('exam_on'),
  cost: numeric('cost', { precision: 10, scale: 2, mode: 'number' }),
  obtainedOn: date('obtained_on'),
  expiresOn: date('expires_on'),
  credentialUrl: text('credential_url'),
  notes: text('notes'),
  createdAt: createdAt(),
});
export type CertificationRow = typeof certifications.$inferSelect;

/** The time you studied, one row per session. */
export const studySessions = studies.table(
  'study_sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    date: date('date').notNull(),
    minutes: integer('minutes').notNull(),
    topic: text('topic').$type<StudyTopic>().notNull().default('other'),
    pathId: text('path_id'),
    stepId: text('step_id'),
    courseId: uuid('course_id').references(() => courses.id, {
      onDelete: 'set null',
    }),
    note: text('note'),
    createdAt: createdAt(),
  },
  (table) => [index('study_sessions_date_idx').on(table.date)],
);
export type StudySessionRow = typeof studySessions.$inferSelect;

/** The learning paths you follow (LEARNING_PATHS in libs/contracts). */
export const pathProgress = studies.table('path_progress', {
  pathId: text('path_id').primaryKey(),
  status: text('status').$type<PathStatus>().notNull(),
  startedOn: date('started_on').notNull(),
  targetOn: date('target_on'),
});
export type PathProgressRow = typeof pathProgress.$inferSelect;

/** Your progress on each step of a path; a step with no row is not started. */
export const stepProgress = studies.table('step_progress', {
  stepId: text('step_id').primaryKey(),
  pathId: text('path_id').notNull(),
  status: text('status').$type<StepStatus>().notNull(),
  startedOn: date('started_on'),
  doneOn: date('done_on'),
  notes: text('notes'),
});
export type StepProgressRow = typeof stepProgress.$inferSelect;

/** The plans the study coach wrote, newest kept. */
export const studyPlans = studies.table('study_plans', {
  id: uuid('id').primaryKey().defaultRandom(),
  question: text('question'),
  output: jsonb('output').$type<StudyPlanOutput>().notNull(),
  source: text('source').$type<'claude' | 'offline'>().notNull(),
  model: text('model'),
  createdAt: createdAt(),
});
export type StudyPlanRow = typeof studyPlans.$inferSelect;

/**
 * svc-studies' copy of the settings it reads (AI switches, the weekly goal,
 * reminder windows), kept by its consumer of settings.changed@1.
 */
export const settingsReplica = studies.table('settings_replica', {
  key: text('key').primaryKey(),
  value: jsonb('value').notNull(),
  changedAt: timestamp('changed_at', { withTimezone: true }).notNull(),
});
