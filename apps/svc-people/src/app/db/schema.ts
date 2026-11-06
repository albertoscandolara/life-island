import {
  boolean,
  date,
  index,
  jsonb,
  pgSchema,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import type { PersonField } from '@life-island/contracts';

export const people = pgSchema('people');

type Fields = Record<string, string | number | boolean | null>;

/**
 * The people your ID documents belong to: one row per person, holding the
 * merged personal data. A row is created or changed only when you approve a
 * document's review (or edit it by hand).
 */
export const persons = people.table('persons', {
  id: uuid('id').primaryKey().defaultRandom(),
  lastName: text('last_name'),
  firstName: text('first_name'),
  /** Codice fiscale; the natural key when printed. */
  taxCode: text('tax_code').unique(),
  birthDate: date('birth_date', { mode: 'string' }),
  birthPlace: text('birth_place'),
  sex: text('sex'),
  citizenship: text('citizenship'),
  residenceAddress: text('residence_address'),
  /**
   * The svc-home property picked as residence (no foreign key: it lives in
   * the home schema). `residence_address` keeps its address as text.
   */
  residencePropertyId: uuid('residence_property_id'),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type PersonRow = typeof persons.$inferSelect;

/**
 * The documents you uploaded, mirrored from ingestion's `upload.*` events: a
 * bill is a document whose confirmed categories include a bill category.
 * A deleted document stays as a tombstone (`deleted_at`).
 */
export const documents = people.table(
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
 * The category hierarchy, mirrored from `category.changed`, so an ID document
 * filed under a subcategory of PASSPORT still counts.
 */
export const categoryTree = people.table('category_tree', {
  id: text('id').primaryKey(),
  title: text('title').notNull(),
  parentId: text('parent_id'),
  dimension: text('dimension'),
  deleted: boolean('deleted').notNull().default(false),
  changedAt: timestamp('changed_at', { withTimezone: true }).notNull(),
});

export type CategoryRow = typeof categoryTree.$inferSelect;

/** One decided field of a review: what the person had, what was printed, what you chose. */
export interface DecidedChange {
  field: PersonField;
  previous: string | null;
  proposed: string;
  decision: 'accepted' | 'kept_current';
}

/**
 * Your decision on an ID document: whose it is (approved) or nobody's
 * (rejected), with every field you took or kept. The approved ones are the
 * history of each person's data. A document with no row waits for review.
 */
export const reviews = people.table(
  'reviews',
  {
    uploadId: uuid('upload_id').primaryKey(),
    status: text('status').$type<'approved' | 'rejected'>().notNull(),
    personId: uuid('person_id').references(() => persons.id, {
      onDelete: 'cascade',
    }),
    createdPerson: boolean('created_person').notNull().default(false),
    changes: jsonb('changes').$type<DecidedChange[]>().notNull().default([]),
    /** Lost, stolen or withdrawn, as you marked the document. */
    markedStatus: text('marked_status'),
    decidedAt: timestamp('decided_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [index('reviews_person_idx').on(table.personId)],
);

export type ReviewRow = typeof reviews.$inferSelect;
