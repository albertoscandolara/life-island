import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { requireRow, type RecordCollection } from '@life-island/be-nest';
import {
  bookingRequestSchema,
  checklistItemRequestSchema,
  travelExpenseRequestSchema,
  tripRequestSchema,
} from '@life-island/contracts';
import { bookings, checklistItems, expenses, trips } from '../db/schema.js';

export const RECORDS = Symbol('TravelRecords');

/** Travel's plain records: trips and, inside each, bookings, checklist and expenses. */
export function collections(db: NodePgDatabase): RecordCollection[] {
  const inTrip = (request: { tripId?: string }) =>
    requireRow(db, trips, request.tripId, 'Trip');
  return [
    { name: 'trips', label: 'Trip', table: trips, request: tripRequestSchema },
    {
      name: 'bookings',
      label: 'Booking',
      table: bookings,
      request: bookingRequestSchema,
      check: inTrip,
    },
    {
      name: 'checklist',
      label: 'Checklist item',
      table: checklistItems,
      request: checklistItemRequestSchema,
      check: inTrip,
    },
    {
      name: 'expenses',
      label: 'Expense',
      table: expenses,
      request: travelExpenseRequestSchema,
      check: inTrip,
    },
  ];
}
