import type {
  HouseField,
  ModelFormat,
  PropertyOwnerDto,
  PropertyTenure,
  PropertyType,
} from '@life-island/contracts';
import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgSchema,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

export const home = pgSchema('home');

type Fields = Record<string, string | number | boolean | null>;

const decimal = (name: string) =>
  numeric(name, { precision: 14, scale: 2, mode: 'number' });

/** Your houses: Via Ponzilovo, Via dei Bandi... */
export const properties = home.table(
  'properties',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    type: text('type').$type<PropertyType>().notNull().default('HOUSE'),
    tenure: text('tenure').$type<PropertyTenure>().notNull().default('OWNED'),
    /** The one house you live in (a partial unique index keeps it to one). */
    isResidence: boolean('is_residence').notNull().default(false),
    address: text('address'),
    postalCode: text('postal_code'),
    city: text('city'),
    province: text('province'),
    country: text('country'),
    areaSqm: decimal('area_sqm'),
    rooms: decimal('rooms'),
    yearBuilt: integer('year_built'),
    cadastralSheet: text('cadastral_sheet'),
    cadastralParcel: text('cadastral_parcel'),
    cadastralSubunit: text('cadastral_subunit'),
    cadastralCategory: text('cadastral_category'),
    cadastralIncome: decimal('cadastral_income'),
    purchaseDate: date('purchase_date', { mode: 'string' }),
    purchasePrice: decimal('purchase_price'),
    /** People of the People area (by id, no foreign key: another schema) or typed names. */
    owners: jsonb('owners').$type<PropertyOwnerDto[]>().notNull().default([]),
    electricitySupplier: text('electricity_supplier'),
    gasSupplier: text('gas_supplier'),
    waterSupplier: text('water_supplier'),
    condoManager: text('condo_manager'),
    insurer: text('insurer'),
    /** Fixed chart colour slot, given once at creation. */
    colorSlot: integer('color_slot').notNull(),
    /** Words that identify its documents, e.g. "ponzilovo". */
    matchTerms: text('match_terms').array().notNull().default([]),
    /** POD, PDR and water customer codes printed on its bills. */
    supplyCodes: text('supply_codes').array().notNull().default([]),
    /** Document categories that mean "this home" (by id; they live in ingestion). */
    categoryIds: text('category_ids').array().notNull().default([]),
    notes: text('notes'),
    /** Its 3D model, in this service's own bucket (the file never goes in the database). */
    modelKey: text('model_key'),
    modelFilename: text('model_filename'),
    modelFormat: text('model_format').$type<ModelFormat>(),
    modelSize: bigint('model_size', { mode: 'number' }),
    modelUploadedAt: timestamp('model_uploaded_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex('properties_one_residence_idx')
      .on(table.isResidence)
      .where(sql`${table.isResidence}`),
  ],
);

export type PropertyRow = typeof properties.$inferSelect;

/**
 * The documents you uploaded, mirrored from ingestion's `upload.*` events: a
 * bill is a document whose confirmed categories include a bill category.
 * A deleted document stays as a tombstone (`deleted_at`).
 */
export const documents = home.table(
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
 * The category hierarchy, mirrored from `category.changed`, so a bill filed
 * under a subcategory (ENEL_BILL under ELECTRICITY_BILL) still counts.
 */
export const categoryTree = home.table('category_tree', {
  id: text('id').primaryKey(),
  title: text('title').notNull(),
  parentId: text('parent_id'),
  dimension: text('dimension'),
  deleted: boolean('deleted').notNull().default(false),
  changedAt: timestamp('changed_at', { withTimezone: true }).notNull(),
});

export type CategoryRow = typeof categoryTree.$inferSelect;

/** Your corrections to what was read automatically from a bill. */
export const billOverrides = home.table('bill_overrides', {
  uploadId: uuid('upload_id').primaryKey(),
  /** True when you picked the property (null property: on no property). */
  manualProperty: boolean('manual_property').notNull().default(false),
  propertyId: uuid('property_id').references(() => properties.id, {
    onDelete: 'set null',
  }),
  utility: text('utility'),
  excluded: boolean('excluded').notNull().default(false),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type BillOverrideRow = typeof billOverrides.$inferSelect;

/** A renovation, repair or maintenance job on one property. */
export const works = home.table(
  'works',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    propertyId: uuid('property_id')
      .notNull()
      .references(() => properties.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    kind: text('kind').notNull(),
    status: text('status').notNull(),
    area: text('area'),
    contractor: text('contractor'),
    startDate: date('start_date', { mode: 'string' }),
    endDate: date('end_date', { mode: 'string' }),
    estimatedCost: numeric('estimated_cost', {
      precision: 12,
      scale: 2,
      mode: 'number',
    }),
    actualCost: numeric('actual_cost', {
      precision: 12,
      scale: 2,
      mode: 'number',
    }),
    notes: text('notes'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [index('works_property_idx').on(table.propertyId)],
);

export type WorkRow = typeof works.$inferSelect;

/** Documents filed for a work: invoices, quotes, photos (by id; files live in ingestion). */
export const workDocuments = home.table(
  'work_documents',
  {
    workId: uuid('work_id')
      .notNull()
      .references(() => works.id, { onDelete: 'cascade' }),
    uploadId: uuid('upload_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.workId, table.uploadId] })],
);

/** One decided field of a house suggestion: what the house had, what was read, what you chose. */
export interface DecidedHouseChange {
  field: HouseField;
  previous: string | null;
  proposed: string;
  decision: 'accepted' | 'kept_current';
}

/**
 * Your decision on what a document says about a house: taken into a house
 * (approved, maybe creating it) or dismissed. A document with house data and
 * no row here is still a suggestion.
 */
export const houseReviews = home.table(
  'house_reviews',
  {
    uploadId: uuid('upload_id').primaryKey(),
    status: text('status').$type<'approved' | 'dismissed'>().notNull(),
    propertyId: uuid('property_id').references(() => properties.id, {
      onDelete: 'set null',
    }),
    createdProperty: boolean('created_property').notNull().default(false),
    changes: jsonb('changes')
      .$type<DecidedHouseChange[]>()
      .notNull()
      .default([]),
    decidedAt: timestamp('decided_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [index('house_reviews_property_idx').on(table.propertyId)],
);

export type HouseReviewRow = typeof houseReviews.$inferSelect;
