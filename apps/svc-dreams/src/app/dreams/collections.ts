import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { requireRow, type RecordCollection } from '@life-island/be-nest';
import {
  DREAM_DEFAULT_CONTEXT,
  dreamRequestSchema,
  dreamStepRequestSchema,
  habitRequestSchema,
  isoToday,
  type DreamRequest,
  type DreamStepRequest,
  type HabitRequest,
} from '@life-island/contracts';
import { dreams, dreamSteps, habits } from '../db/schema.js';

export const RECORDS = Symbol('DreamsRecords');

const today = () => isoToday(process.env['SETTINGS_TIMEZONE'] || 'Europe/Rome');

/** Dreams' plain records: the dreams, the steps you write or edit yourself, and habits. */
export function collections(db: NodePgDatabase): RecordCollection[] {
  return [
    {
      name: 'dreams',
      label: 'Dream',
      table: dreams,
      request: dreamRequestSchema,
      // A new dream offers the areas that usually matter for it; you untick any.
      toValues: (request: Partial<DreamRequest>) =>
        request.contextAreas === undefined && request.area && request.title
          ? { ...request, contextAreas: DREAM_DEFAULT_CONTEXT[request.area] }
          : request,
    },
    {
      name: 'steps',
      label: 'Step',
      table: dreamSteps,
      request: dreamStepRequestSchema,
      check: (request: Partial<DreamStepRequest>) =>
        requireRow(db, dreams, request.dreamId, 'Dream'),
      toValues: (request: Partial<DreamStepRequest>) =>
        request.status === undefined
          ? request
          : { ...request, doneOn: request.status === 'done' ? today() : null },
    },
    {
      name: 'habits',
      label: 'Habit',
      table: habits,
      request: habitRequestSchema,
      check: (request: Partial<HabitRequest>) =>
        requireRow(db, dreams, request.dreamId, 'Dream'),
    },
  ];
}
