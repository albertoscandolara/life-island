import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { requireRow, type RecordCollection } from '@life-island/be-nest';
import {
  goalRequestSchema,
  goalStepRequestSchema,
  habitRequestSchema,
  isoToday,
  type GoalStepRequest,
  type HabitRequest,
} from '@life-island/contracts';
import { goals, goalSteps, habits } from '../db/schema.js';

export const RECORDS = Symbol('GoalsRecords');

const today = () => isoToday(process.env['SETTINGS_TIMEZONE'] || 'Europe/Rome');

/** Goals' plain records: goals, their steps and habits. */
export function collections(db: NodePgDatabase): RecordCollection[] {
  return [
    { name: 'goals', label: 'Goal', table: goals, request: goalRequestSchema },
    {
      name: 'steps',
      label: 'Step',
      table: goalSteps,
      request: goalStepRequestSchema,
      check: (request: Partial<GoalStepRequest>) =>
        requireRow(db, goals, request.goalId, 'Goal'),
      // Ticking a step remembers the day, so the goal knows it is moving.
      toValues: (request: Partial<GoalStepRequest>) =>
        request.done === undefined
          ? request
          : { ...request, doneOn: request.done ? today() : null },
    },
    {
      name: 'habits',
      label: 'Habit',
      table: habits,
      request: habitRequestSchema,
      check: (request: Partial<HabitRequest>) =>
        requireRow(db, goals, request.goalId, 'Goal'),
    },
  ];
}
