import {
  boolean,
  index,
  jsonb,
  pgSchema,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import type {
  VehicleField,
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
    decidedAt: timestamp('decided_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [index('reviews_vehicle_idx').on(table.vehicleId)],
);

export type ReviewRow = typeof reviews.$inferSelect;
