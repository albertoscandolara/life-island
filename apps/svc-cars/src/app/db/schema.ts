import {
  bigint,
  boolean,
  index,
  integer,
  jsonb,
  pgSchema,
  real,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import type {
  ModelFormat,
  QuoteComparisonOutput,
  TyreSeason,
  VehicleField,
  VehiclePartyField,
  VehicleStatus,
  VehicleValue,
} from '@life-island/contracts';

export const cars = pgSchema('cars');

type Fields = Record<string, string | number | boolean | null>;

/**
 * Your cars: one row per vehicle, with the values of its carta di
 * circolazione under the JSON model's names (`values`, keyed by
 * VEHICLE_FIELDS). A row is created or changed only when you approve a
 * document's review, or add or edit it by hand.
 */
export const vehicles = cars.table('vehicles', {
  id: uuid('id').primaryKey().defaultRandom(),
  label: text('label'),
  status: text('status').$type<VehicleStatus>().notNull().default('active'),
  values: jsonb('values')
    .$type<Partial<Record<VehicleField, VehicleValue>>>()
    .notNull()
    .default({}),
  /** The person of People each party (holder, owner) is, when you picked one. */
  people: jsonb('people')
    .$type<Partial<Record<VehiclePartyField, string>>>()
    .notNull()
    .default({}),
  /** Its 3D model, in this service's own bucket (the file never goes in the database). */
  modelKey: text('model_key'),
  modelFilename: text('model_filename'),
  modelFormat: text('model_format').$type<ModelFormat>(),
  modelSize: bigint('model_size', { mode: 'number' }),
  modelUploadedAt: timestamp('model_uploaded_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type VehicleRow = typeof vehicles.$inferSelect;

/**
 * The documents you uploaded, mirrored from ingestion's `upload.*` events: a
 * car document is one whose categories include a car category. A deleted
 * document stays as a tombstone (`deleted_at`).
 */
export const documents = cars.table(
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
 * The category hierarchy, mirrored from `category.changed`, so a car document
 * filed under a subcategory of CAR_INSURANCE still counts.
 */
export const categoryTree = cars.table('category_tree', {
  id: text('id').primaryKey(),
  title: text('title').notNull(),
  parentId: text('parent_id'),
  dimension: text('dimension'),
  deleted: boolean('deleted').notNull().default(false),
  changedAt: timestamp('changed_at', { withTimezone: true }).notNull(),
});

export type CategoryRow = typeof categoryTree.$inferSelect;

/** One decided field of a review: what the car had, what was printed, what you chose. */
export interface DecidedVehicleChange {
  field: VehicleField;
  previous: VehicleValue;
  proposed: string | number;
  decision: 'accepted' | 'kept_current';
}

/**
 * Your decision on a car document: which car it is about (approved) or none
 * (rejected), with every field you took or kept. The approved ones are the
 * history of each car's data. A document with no row waits for review.
 */
export const reviews = cars.table(
  'reviews',
  {
    uploadId: uuid('upload_id').primaryKey(),
    status: text('status').$type<'approved' | 'rejected'>().notNull(),
    vehicleId: uuid('vehicle_id').references(() => vehicles.id, {
      onDelete: 'cascade',
    }),
    createdVehicle: boolean('created_vehicle').notNull().default(false),
    changes: jsonb('changes')
      .$type<DecidedVehicleChange[]>()
      .notNull()
      .default([]),
    /** Cancelled, as you marked the document. */
    markedStatus: text('marked_status'),
    /**
     * The record you put it in by hand (`number:<n>` or `own:<uploadId>`);
     * null: the record of every document with its number.
     */
    groupKey: text('group_key'),
    decidedAt: timestamp('decided_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [index('reviews_vehicle_idx').on(table.vehicleId)],
);

export type ReviewRow = typeof reviews.$inferSelect;

/**
 * What you add by hand to a fine filed as a car expense: the day it reached
 * you (every deadline runs from it), the day you paid, the points and who
 * was driving. What the fine prints stays in its document.
 */
export const fines = cars.table('fines', {
  uploadId: uuid('upload_id').primaryKey(),
  notifiedOn: text('notified_on'),
  paidOn: text('paid_on'),
  points: integer('points'),
  /** A person of People (svc-people), or only a typed name. */
  driverPersonId: uuid('driver_person_id'),
  driverName: text('driver_name'),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type FineRow = typeof fines.$inferSelect;

/** The tyre sets of each car, typed by you; one of them is on the car. */
export const tyreSets = cars.table(
  'tyre_sets',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    vehicleId: uuid('vehicle_id')
      .notNull()
      .references(() => vehicles.id, { onDelete: 'cascade' }),
    season: text('season').$type<TyreSeason>().notNull(),
    label: text('label'),
    size: text('size'),
    dot: text('dot'),
    purchasedOn: text('purchased_on'),
    treadMm: real('tread_mm'),
    mounted: boolean('mounted').notNull().default(false),
    storedAt: text('stored_at'),
    notes: text('notes'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [index('tyre_sets_vehicle_idx').on(table.vehicleId)],
);

export type TyreSetRow = typeof tyreSets.$inferSelect;

/**
 * Each insurance quote comparison Claude wrote: the names of the files you
 * uploaded (the files themselves are never kept) and its answer.
 */
export const quoteComparisons = cars.table(
  'quote_comparisons',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    vehicleId: uuid('vehicle_id')
      .notNull()
      .references(() => vehicles.id, { onDelete: 'cascade' }),
    files: text('files').array().notNull().default([]),
    note: text('note'),
    output: jsonb('output').$type<QuoteComparisonOutput>().notNull(),
    model: text('model'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [index('quote_comparisons_vehicle_idx').on(table.vehicleId)],
);

export type QuoteComparisonRow = typeof quoteComparisons.$inferSelect;

/**
 * svc-cars' copy of the settings it reads (the switch of its AI tool), kept
 * by its consumer of settings.changed@1. Nothing else writes it.
 */
export const settingsReplica = cars.table('settings_replica', {
  key: text('key').primaryKey(),
  value: jsonb('value').notNull(),
  changedAt: timestamp('changed_at', { withTimezone: true }).notNull(),
});
