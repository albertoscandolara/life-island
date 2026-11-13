import type {
  BillAssignment,
  HouseField,
  ModelFormat,
  OrganizationRole,
  OrganizationStatus,
  UtilityKind,
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

// ---------------------------------------------------------------------------
// Bills as entities (the model of life-island-docs/entities): a house has
// supply points, each supplied under contracts with a supplier, and every
// bill points to its supply point and contract. They are kept in step with
// your bill documents by BillLedger; your corrections stay in bill_overrides.

/** A company or public office (supplier, distributor...), one row whatever its role. */
export const organizations = home.table(
  'organizations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    /** Name without case, accents or legal form: how a name printed differently still matches. */
    nameKey: text('name_key').notNull(),
    taxCode: text('tax_code'),
    vatNumber: text('vat_number'),
    roles: text('roles')
      .array()
      .$type<OrganizationRole[]>()
      .notNull()
      .default([]),
    /**
     * PENDING: a document named it and it waits for you to confirm it.
     * CONFIRMED: a company you know, linked everywhere. DISMISSED: not a
     * company (a misread name); kept so it is never suggested again.
     */
    status: text('status')
      .$type<OrganizationStatus>()
      .notNull()
      .default('PENDING'),
    /** Other names documents print for it (kept when you merge a duplicate in). */
    aliases: text('aliases').array().notNull().default([]),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex('organizations_tax_code_idx')
      .on(table.taxCode)
      .where(sql`${table.taxCode} is not null`),
    index('organizations_name_key_idx').on(table.nameKey),
  ],
);

export type OrganizationRow = typeof organizations.$inferSelect;

/** Where a utility is delivered (POD, PDR, water code): belongs to a house, outlives contracts. */
export const supplyPoints = home.table(
  'supply_points',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    utility: text('utility').$type<UtilityKind>().notNull(),
    /** The code without spaces, upper case: the natural key. */
    code: text('code').notNull().unique(),
    propertyId: uuid('property_id').references(() => properties.id, {
      onDelete: 'set null',
    }),
    distributorId: uuid('distributor_id').references(() => organizations.id, {
      onDelete: 'set null',
    }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [index('supply_points_property_idx').on(table.propertyId)],
);

export type SupplyPointRow = typeof supplyPoints.$inferSelect;

/** A supplier × customer code × supply point. */
export const supplyContracts = home.table(
  'supply_contracts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    supplyPointId: uuid('supply_point_id').references(() => supplyPoints.id, {
      onDelete: 'cascade',
    }),
    supplierId: uuid('supplier_id').references(() => organizations.id, {
      onDelete: 'set null',
    }),
    customerCode: text('customer_code'),
    offerName: text('offer_name'),
    /** Natural key: supplier, customer code and supply point, normalised. */
    naturalKey: text('natural_key').notNull().unique(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [index('supply_contracts_point_idx').on(table.supplyPointId)],
);

export type SupplyContractRow = typeof supplyContracts.$inferSelect;

/** One bill, read from one document; its house comes from its supply point unless you moved it. */
export const bills = home.table(
  'bills',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** The document it was read from (by id: the file lives in ingestion). */
    uploadId: uuid('upload_id').notNull().unique(),
    title: text('title').notNull(),
    utility: text('utility').$type<UtilityKind>().notNull(),
    utilityOverridden: boolean('utility_overridden').notNull().default(false),
    supplierId: uuid('supplier_id').references(() => organizations.id, {
      onDelete: 'set null',
    }),
    supplyPointId: uuid('supply_point_id').references(() => supplyPoints.id, {
      onDelete: 'set null',
    }),
    contractId: uuid('contract_id').references(() => supplyContracts.id, {
      onDelete: 'set null',
    }),
    /**
     * The bill's own house: only when it has no supply point, or when you
     * picked one by hand. Otherwise its house is its supply point's, read
     * through it, so moving a supply point moves its bills.
     */
    propertyId: uuid('property_id').references(() => properties.id, {
      onDelete: 'set null',
    }),
    /** You picked the house (null house: on none). */
    manualProperty: boolean('manual_property').notNull().default(false),
    assignment: text('assignment').$type<BillAssignment>(),
    invoiceNumber: text('invoice_number'),
    /** Another document of the same invoice (same supplier and number): this one is not counted. */
    duplicateOf: uuid('duplicate_of'),
    issueDate: date('issue_date', { mode: 'string' }),
    dueDate: date('due_date', { mode: 'string' }),
    periodStart: date('period_start', { mode: 'string' }),
    periodEnd: date('period_end', { mode: 'string' }),
    amount: decimal('amount').notNull(),
    totalDue: decimal('total_due'),
    currency: text('currency').notNull().default('EUR'),
    consumption: numeric('consumption', {
      precision: 14,
      scale: 3,
      mode: 'number',
    }),
    unit: text('unit').notNull(),
    provider: text('provider'),
    customerId: text('customer_id'),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index('bills_property_idx').on(table.propertyId),
    index('bills_supply_point_idx').on(table.supplyPointId),
  ],
);

export type BillRow = typeof bills.$inferSelect;
