import {
  boolean,
  date,
  doublePrecision,
  integer,
  jsonb,
  pgSchema,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import type {
  Intensity,
  TrainingPlanOutput,
  WorkoutKind,
} from '@life-island/contracts';

export const fitness = pgSchema('fitness');

const createdAt = () =>
  timestamp('created_at', { withTimezone: true }).notNull().defaultNow();

export const workouts = fitness.table('workouts', {
  id: uuid('id').primaryKey().defaultRandom(),
  date: date('date').notNull(),
  kind: text('kind').$type<WorkoutKind>().notNull().default('walk'),
  minutes: integer('minutes').notNull(),
  distanceKm: doublePrecision('distance_km'),
  intensity: text('intensity').$type<Intensity>().notNull().default('moderate'),
  notes: text('notes'),
  createdAt: createdAt(),
});

/** Weight, waist, resting heart rate, sleep and steps on one day. */
export const measurements = fitness.table('measurements', {
  id: uuid('id').primaryKey().defaultRandom(),
  date: date('date').notNull(),
  weightKg: doublePrecision('weight_kg'),
  waistCm: doublePrecision('waist_cm'),
  restingHr: integer('resting_hr'),
  sleepHours: doublePrecision('sleep_hours'),
  steps: integer('steps'),
  createdAt: createdAt(),
});

/** A race, a hike, a match to train for. */
export const fitnessEvents = fitness.table('events', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  date: date('date').notNull(),
  target: text('target'),
  done: boolean('done').notNull().default(false),
  result: text('result'),
  notes: text('notes'),
  createdAt: createdAt(),
});

/** The training plans written, newest kept. */
export const trainingPlans = fitness.table('training_plans', {
  id: uuid('id').primaryKey().defaultRandom(),
  question: text('question'),
  output: jsonb('output').$type<TrainingPlanOutput>().notNull(),
  source: text('source').$type<'claude' | 'offline'>().notNull(),
  model: text('model'),
  createdAt: createdAt(),
});
export type TrainingPlanRow = typeof trainingPlans.$inferSelect;

/** svc-fitness' copy of the settings it reads, kept by its settings.changed@1 consumer. */
export const settingsReplica = fitness.table('settings_replica', {
  key: text('key').primaryKey(),
  value: jsonb('value').notNull(),
  changedAt: timestamp('changed_at', { withTimezone: true }).notNull(),
});
