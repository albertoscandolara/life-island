import {
  boolean,
  date,
  index,
  integer,
  primaryKey,
  jsonb,
  numeric,
  pgSchema,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import type {
  CareerEventKind,
  CareerFeedbackOutput,
  GoalStatus,
  MarketCheckOutput,
  PlatformStatus,
  WorkplaceField,
  WorkplaceStatus,
  WorkplaceValue,
} from '@life-island/contracts';

export const work = pgSchema('work');

type Fields = Record<string, string | number | boolean | null>;

/**
 * Your workplaces: one row per employment, with the employer, its work site
 * and your employment there under the JSON model's names (`values`, keyed by
 * WORKPLACE_FIELDS). A row is created or changed only when you approve a
 * document's review, or add or edit it by hand.
 */
export const workplaces = work.table('workplaces', {
  id: uuid('id').primaryKey().defaultRandom(),
  label: text('label'),
  status: text('status').$type<WorkplaceStatus>().notNull().default('current'),
  values: jsonb('values')
    .$type<Partial<Record<WorkplaceField, WorkplaceValue>>>()
    .notNull()
    .default({}),
  notes: text('notes'),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type WorkplaceRow = typeof workplaces.$inferSelect;

/**
 * The documents you uploaded, mirrored from ingestion's `upload.*` events: a
 * work document is one whose categories include a work category. A deleted
 * document stays as a tombstone (`deleted_at`).
 */
export const documents = work.table(
  'documents',
  {
    uploadId: uuid('upload_id').primaryKey(),
    title: text('title').notNull(),
    originalFilename: text('original_filename').notNull(),
    categories: text('categories').array().notNull().default([]),
    fields: jsonb('fields').$type<Fields>(),
    uploadedAt: timestamp('uploaded_at', { withTimezone: true }).notNull(),
    /** `updatedAt` of the last `upload.updated` applied; older snapshots are ignored. */
    metadataUpdatedAt: timestamp('metadata_updated_at', { withTimezone: true }),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (table) => [index('documents_categories_idx').using('gin', table.categories)],
);

export type DocumentRow = typeof documents.$inferSelect;

/**
 * The category hierarchy, mirrored from `category.changed`, so a payslip filed
 * under a subcategory of PAYSLIP still counts.
 */
export const categoryTree = work.table('category_tree', {
  id: text('id').primaryKey(),
  title: text('title').notNull(),
  parentId: text('parent_id'),
  dimension: text('dimension'),
  deleted: boolean('deleted').notNull().default(false),
  changedAt: timestamp('changed_at', { withTimezone: true }).notNull(),
});

/** One decided field of a review: what the workplace had, what was printed, what you chose. */
export interface DecidedWorkplaceChange {
  field: WorkplaceField;
  previous: WorkplaceValue;
  proposed: string | number;
  decision: 'accepted' | 'kept_current';
}

/**
 * Your decision on a work document: which workplace it is about (approved) or
 * none (rejected), with every field you took or kept. The approved ones make
 * the timeline and the statistics. A document with no row waits for review.
 */
export const reviews = work.table(
  'reviews',
  {
    uploadId: uuid('upload_id').primaryKey(),
    status: text('status').$type<'approved' | 'rejected'>().notNull(),
    workplaceId: uuid('workplace_id').references(() => workplaces.id, {
      onDelete: 'cascade',
    }),
    createdWorkplace: boolean('created_workplace').notNull().default(false),
    changes: jsonb('changes')
      .$type<DecidedWorkplaceChange[]>()
      .notNull()
      .default([]),
    decidedAt: timestamp('decided_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [index('reviews_workplace_idx').on(table.workplaceId)],
);

export type ReviewRow = typeof reviews.$inferSelect;

/** Events of your career you add by hand: a course, an award, a promotion no document shows. */
export const careerEvents = work.table('career_events', {
  id: uuid('id').primaryKey().defaultRandom(),
  date: date('date', { mode: 'string' }).notNull(),
  kind: text('kind').$type<CareerEventKind>().notNull(),
  title: text('title').notNull(),
  detail: text('detail'),
  workplaceId: uuid('workplace_id').references(() => workplaces.id, {
    onDelete: 'set null',
  }),
  amount: numeric('amount', { precision: 12, scale: 2, mode: 'number' }),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type CareerEventRow = typeof careerEvents.$inferSelect;

/** The hiring platforms you signed up to. */
export const hiringPlatforms = work.table('hiring_platforms', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  url: text('url').notNull(),
  account: text('account'),
  status: text('status').$type<PlatformStatus>().notNull().default('active'),
  profileUpdatedAt: date('profile_updated_at', { mode: 'string' }),
  notes: text('notes'),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type HiringPlatformRow = typeof hiringPlatforms.$inferSelect;

/** Every career feedback you asked for, with what it was written from. */
export const careerFeedback = work.table('career_feedback', {
  id: uuid('id').primaryKey().defaultRandom(),
  question: text('question'),
  source: text('source').$type<'claude' | 'offline'>().notNull(),
  model: text('model'),
  output: jsonb('output').$type<CareerFeedbackOutput>().notNull(),
  documentsUsed: integer('documents_used').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type CareerFeedbackRow = typeof careerFeedback.$inferSelect;

/**
 * Where each goal of an evaluation stands, as you marked it. A goal is the
 * evaluation that set it plus its normalized text (`goalKey`); a goal with
 * no row is open.
 */
export const goalStatuses = work.table(
  'goal_statuses',
  {
    uploadId: uuid('upload_id').notNull(),
    goalKey: text('goal_key').notNull(),
    status: text('status').$type<GoalStatus>().notNull(),
    note: text('note'),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.uploadId, table.goalKey] })],
);

export type GoalStatusRow = typeof goalStatuses.$inferSelect;

/** Every market check you ran: public salary ranges Claude found on the web, against your RAL then. */
export const marketChecks = work.table('market_checks', {
  id: uuid('id').primaryKey().defaultRandom(),
  model: text('model'),
  ral: numeric('ral', { precision: 12, scale: 2, mode: 'number' }),
  output: jsonb('output').$type<MarketCheckOutput>().notNull(),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type MarketCheckRow = typeof marketChecks.$inferSelect;
