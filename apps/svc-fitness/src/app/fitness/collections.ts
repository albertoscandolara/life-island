import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type { RecordCollection } from '@life-island/be-nest';
import {
  fitnessEventRequestSchema,
  measurementRequestSchema,
  workoutRequestSchema,
} from '@life-island/contracts';
import { fitnessEvents, measurements, workouts } from '../db/schema.js';

export const RECORDS = Symbol('FitnessRecords');

/** Fitness' plain records. */
export function collections(_db: NodePgDatabase): RecordCollection[] {
  return [
    { name: 'workouts', label: 'Workout', table: workouts, request: workoutRequestSchema },
    { name: 'measurements', label: 'Measurement', table: measurements, request: measurementRequestSchema },
    { name: 'events', label: 'Event', table: fitnessEvents, request: fitnessEventRequestSchema },
  ];
}
