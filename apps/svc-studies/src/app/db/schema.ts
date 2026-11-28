import {
  boolean,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgSchema,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import type {
  BillingPeriod,
  OutlineChangeKind,
  ScoutResourceKind,
  ScoutResourceStatus,
  ScoutScanReason,
  ScoutScanStatus,
  StepKind,
  StepPace,
  CertificationStatus,
  CourseStatus,
  PathStage,
  PathStatus,
  RecallResult,
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

/**
 * The paths you wrote, and the curated ones you changed (same id as the
 * template, which this row then replaces). A curated path you only follow
 * has no row here: it is read from LEARNING_PATHS in libs/contracts.
 */
export const learningPaths = studies.table('learning_paths', {
  id: text('id').primaryKey(),
  topic: text('topic').$type<StudyTopic>().notNull(),
  emblem: text('emblem').notNull(),
  name: text('name').notNull(),
  summary: text('summary').notNull().default(''),
  why: text('why').notNull().default(''),
  capstone: text('capstone').notNull().default(''),
  certifications: jsonb('certifications')
    .$type<string[]>()
    .notNull()
    .default([]),
  stages: jsonb('stages').$type<PathStage[]>().notNull(),
  /** The curated path it started from, if any. */
  templateId: text('template_id'),
  createdAt: createdAt(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});
export type LearningPathRow = typeof learningPaths.$inferSelect;

/** The learning paths you follow: a curated one or one of yours. */
export const pathProgress = studies.table('path_progress', {
  pathId: text('path_id').primaryKey(),
  status: text('status').$type<PathStatus>().notNull(),
  startedOn: date('started_on').notNull(),
  targetOn: date('target_on'),
  /** Whether the resource scout keeps this path current while you follow it. */
  scoutWatch: boolean('scout_watch').notNull().default(true),
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

/** Every scan of the resource scout (AI tool studies.resource-scout). */
export const scoutScans = studies.table(
  'scout_scans',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    pathId: text('path_id').notNull(),
    reason: text('reason').$type<ScoutScanReason>().notNull(),
    status: text('status').$type<ScoutScanStatus>().notNull(),
    stepIds: text('step_ids').array().notNull().default([]),
    found: integer('found').notNull().default(0),
    flagged: integer('flagged').notNull().default(0),
    proposed: integer('proposed').notNull().default(0),
    error: text('error'),
    model: text('model'),
    startedAt: timestamp('started_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
  },
  (table) => [index('scout_scans_path_idx').on(table.pathId, table.startedAt)],
);
export type ScoutScanRow = typeof scoutScans.$inferSelect;

/**
 * The resources the scout found, one row per step and address: suggested
 * until you pin or dismiss it. A dismissed one is kept so it never returns.
 */
export const scoutResources = studies.table(
  'scout_resources',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    pathId: text('path_id').notNull(),
    stepId: text('step_id').notNull(),
    url: text('url').notNull(),
    title: text('title').notNull(),
    kind: text('kind').$type<ScoutResourceKind>().notNull(),
    publishedOn: text('published_on'),
    free: boolean('free').notNull().default(true),
    why: text('why').notNull(),
    status: text('status').$type<ScoutResourceStatus>().notNull(),
    /** Why the last scan found this pinned resource outdated. */
    outdated: text('outdated'),
    scanId: uuid('scan_id'),
    foundAt: timestamp('found_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
  },
  (table) => [
    uniqueIndex('scout_resources_step_url_idx').on(table.stepId, table.url),
  ],
);
export type ScoutResourceRow = typeof scoutResources.$inferSelect;

/** Fast-moving or evergreen, per step the scout scanned. */
export const scoutSteps = studies.table('scout_steps', {
  stepId: text('step_id').primaryKey(),
  pathId: text('path_id').notNull(),
  pace: text('pace').$type<StepPace>().notNull(),
  scannedAt: timestamp('scanned_at', { withTimezone: true }).notNull(),
});

/** Outline changes the scout proposed: a step to add or to retire. */
export const outlineChanges = studies.table('outline_changes', {
  id: uuid('id').primaryKey().defaultRandom(),
  pathId: text('path_id').notNull(),
  kind: text('kind').$type<OutlineChangeKind>().notNull(),
  stageId: text('stage_id').notNull(),
  stepId: text('step_id').notNull(),
  title: text('title'),
  detail: text('detail'),
  outcome: text('outcome'),
  stepKind: text('step_kind').$type<StepKind>(),
  hours: integer('hours'),
  reason: text('reason').notNull(),
  status: text('status')
    .$type<'proposed' | 'accepted' | 'declined'>()
    .notNull()
    .default('proposed'),
  scanId: uuid('scan_id'),
  createdAt: createdAt(),
  decidedAt: timestamp('decided_at', { withTimezone: true }),
});
export type OutlineChangeRow = typeof outlineChanges.$inferSelect;

/**
 * Recall questions of the steps you finished: each comes back after a day,
 * a week and a month; one you miss starts again. Learned cards are deleted.
 */
export const recallCards = studies.table(
  'recall_cards',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    stepId: text('step_id').notNull(),
    pathId: text('path_id').notNull(),
    question: text('question').notNull(),
    answer: text('answer').notNull(),
    round: integer('round').notNull().default(0),
    dueOn: date('due_on').notNull(),
    lastResult: text('last_result').$type<RecallResult>(),
    ai: boolean('ai').notNull().default(false),
    createdAt: createdAt(),
  },
  (table) => [
    index('recall_cards_due_idx').on(table.dueOn),
    index('recall_cards_step_idx').on(table.stepId),
  ],
);
export type RecallCardRow = typeof recallCards.$inferSelect;

/** Steps you learned by heart: their cards answered right three times. */
export const recallLearned = studies.table('recall_learned', {
  id: uuid('id').primaryKey().defaultRandom(),
  stepId: text('step_id').notNull(),
  learnedOn: date('learned_on').notNull(),
});

/**
 * svc-studies' copy of the settings it reads (AI switches, the weekly goal,
 * reminder windows), kept by its consumer of settings.changed@1.
 */
export const settingsReplica = studies.table('settings_replica', {
  key: text('key').primaryKey(),
  value: jsonb('value').notNull(),
  changedAt: timestamp('changed_at', { withTimezone: true }).notNull(),
});
