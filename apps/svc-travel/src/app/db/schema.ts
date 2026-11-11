import {
  boolean,
  date,
  integer,
  jsonb,
  numeric,
  pgSchema,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import type {
  BookingKind,
  TravelExpenseCategory,
  TripPlanOutput,
  TripStatus,
} from '@life-island/contracts';

export const travel = pgSchema('travel');

const createdAt = () =>
  timestamp('created_at', { withTimezone: true }).notNull().defaultNow();
const euro = (name: string) =>
  numeric(name, { precision: 10, scale: 2, mode: 'number' });

export const trips = travel.table('trips', {
  id: uuid('id').primaryKey().defaultRandom(),
  title: text('title').notNull(),
  destination: text('destination').notNull(),
  abroad: boolean('abroad').notNull().default(false),
  startOn: date('start_on'),
  endOn: date('end_on'),
  travellers: integer('travellers').notNull().default(1),
  budget: euro('budget'),
  status: text('status').$type<TripStatus>().notNull().default('planning'),
  notes: text('notes'),
  createdAt: createdAt(),
});
export type TripRow = typeof trips.$inferSelect;

const tripId = () =>
  uuid('trip_id')
    .notNull()
    .references(() => trips.id, { onDelete: 'cascade' });

/** A flight, a train, a stay: with its reference and the last day to cancel. */
export const bookings = travel.table('bookings', {
  id: uuid('id').primaryKey().defaultRandom(),
  tripId: tripId(),
  kind: text('kind').$type<BookingKind>().notNull().default('other'),
  title: text('title').notNull(),
  provider: text('provider'),
  reference: text('reference'),
  date: date('date'),
  time: text('time'),
  cost: euro('cost'),
  paid: boolean('paid').notNull().default(false),
  cancelBy: date('cancel_by'),
  notes: text('notes'),
  createdAt: createdAt(),
});

/** Something to do before leaving, or to pack. */
export const checklistItems = travel.table('checklist_items', {
  id: uuid('id').primaryKey().defaultRandom(),
  tripId: tripId(),
  text: text('text').notNull(),
  dueOn: date('due_on'),
  done: boolean('done').notNull().default(false),
  packing: boolean('packing').notNull().default(false),
  createdAt: createdAt(),
});

/** What you spend while travelling. */
export const expenses = travel.table('expenses', {
  id: uuid('id').primaryKey().defaultRandom(),
  tripId: tripId(),
  date: date('date').notNull(),
  amount: euro('amount').notNull(),
  category: text('category').$type<TravelExpenseCategory>().notNull().default('other'),
  note: text('note'),
  createdAt: createdAt(),
});

/** What the planner wrote for a trip, newest kept. */
export const tripPlans = travel.table('trip_plans', {
  id: uuid('id').primaryKey().defaultRandom(),
  tripId: tripId(),
  question: text('question'),
  output: jsonb('output').$type<TripPlanOutput>().notNull(),
  source: text('source').$type<'claude' | 'offline'>().notNull(),
  model: text('model'),
  createdAt: createdAt(),
});
export type TripPlanRow = typeof tripPlans.$inferSelect;

/** svc-travel's copy of the settings it reads, kept by its settings.changed@1 consumer. */
export const settingsReplica = travel.table('settings_replica', {
  key: text('key').primaryKey(),
  value: jsonb('value').notNull(),
  changedAt: timestamp('changed_at', { withTimezone: true }).notNull(),
});
