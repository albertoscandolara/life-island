import { z } from 'zod';
import {
  lifeAmount,
  lifeDate,
  lifeName,
  lifeNote,
  lifeOptionalDate,
  type LifeAiAnswerDto,
  type LifeRecord,
} from './life-schemas.js';

/*
 * Travel (Quetzal, svc-travel, mfe-travel): trips from the first idea to the
 * way home, with their bookings and the last day to cancel them, a checklist
 * with dates, what each trip costs against its budget, and an AI trip planner
 * that writes the checklist, the packing list and a day-by-day plan.
 */

export const TRIP_STATUSES = [
  'idea',
  'planning',
  'booked',
  'done',
  'cancelled',
] as const;
export type TripStatus = (typeof TRIP_STATUSES)[number];
export const TRIP_STATUS_LABELS: Record<TripStatus, string> = {
  idea: 'Idea',
  planning: 'Planning',
  booked: 'Booked',
  done: 'Done',
  cancelled: 'Cancelled',
};

export const tripRequestSchema = z.object({
  title: lifeName(120),
  destination: lifeName(160),
  /** Outside the Schengen area: passports and visas to check. */
  abroad: z.boolean().optional(),
  startOn: lifeOptionalDate,
  endOn: lifeOptionalDate,
  travellers: z.number().int().min(1).max(50).optional(),
  budget: lifeAmount.nullable().optional(),
  status: z.enum(TRIP_STATUSES).optional(),
  notes: lifeNote(),
});
export type TripRequest = z.input<typeof tripRequestSchema>;

export const BOOKING_KINDS = [
  'flight',
  'train',
  'bus',
  'ferry',
  'car',
  'stay',
  'activity',
  'insurance',
  'other',
] as const;
export type BookingKind = (typeof BOOKING_KINDS)[number];
export const BOOKING_KIND_LABELS: Record<BookingKind, string> = {
  flight: 'Flight',
  train: 'Train',
  bus: 'Bus',
  ferry: 'Ferry',
  car: 'Car rental',
  stay: 'Stay',
  activity: 'Activity or ticket',
  insurance: 'Travel insurance',
  other: 'Other',
};

export const bookingRequestSchema = z.object({
  tripId: z.uuid(),
  kind: z.enum(BOOKING_KINDS).optional(),
  title: lifeName(160),
  provider: lifeNote(120),
  reference: lifeNote(80),
  date: lifeOptionalDate,
  /** "08:40", or anything that helps: "check-in from 15:00". */
  time: lifeNote(60),
  cost: lifeAmount.nullable().optional(),
  paid: z.boolean().optional(),
  /** The last day to cancel for free. */
  cancelBy: lifeOptionalDate,
  notes: lifeNote(1000),
});
export type BookingRequest = z.input<typeof bookingRequestSchema>;

export const checklistItemRequestSchema = z.object({
  tripId: z.uuid(),
  text: lifeName(200),
  dueOn: lifeOptionalDate,
  done: z.boolean().optional(),
  /** Packing list rather than things to do. */
  packing: z.boolean().optional(),
});
export type ChecklistItemRequest = z.input<typeof checklistItemRequestSchema>;

export const TRAVEL_EXPENSE_CATEGORIES = [
  'transport',
  'stay',
  'food',
  'activities',
  'shopping',
  'other',
] as const;
export type TravelExpenseCategory = (typeof TRAVEL_EXPENSE_CATEGORIES)[number];
export const TRAVEL_EXPENSE_LABELS: Record<TravelExpenseCategory, string> = {
  transport: 'Getting around',
  stay: 'Stay',
  food: 'Food and drinks',
  activities: 'Activities',
  shopping: 'Shopping',
  other: 'Other',
};

export const travelExpenseRequestSchema = z.object({
  tripId: z.uuid(),
  date: lifeDate,
  amount: lifeAmount,
  category: z.enum(TRAVEL_EXPENSE_CATEGORIES).optional(),
  note: lifeNote(200),
});
export type TravelExpenseRequest = z.input<typeof travelExpenseRequestSchema>;

export type BookingDto = LifeRecord<{
  tripId: string;
  kind: BookingKind;
  title: string;
  provider: string | null;
  reference: string | null;
  date: string | null;
  time: string | null;
  cost: number | null;
  paid: boolean;
  cancelBy: string | null;
  notes: string | null;
}>;

export type ChecklistItemDto = LifeRecord<{
  tripId: string;
  text: string;
  dueOn: string | null;
  done: boolean;
  packing: boolean;
}>;

export type TravelExpenseDto = LifeRecord<{
  tripId: string;
  date: string;
  amount: number;
  category: TravelExpenseCategory;
  note: string | null;
}>;

export type TripDto = LifeRecord<{
  title: string;
  destination: string;
  abroad: boolean;
  startOn: string | null;
  endOn: string | null;
  travellers: number;
  budget: number | null;
  status: TripStatus;
  notes: string | null;
}> & {
  bookings: BookingDto[];
  checklist: ChecklistItemDto[];
  expenses: TravelExpenseDto[];
  /** Bookings plus expenses. */
  spent: number;
  nights: number | null;
  daysToGo: number | null;
};

export const tripPlanOutputSchema = z.object({
  summary: z.string().describe('Two sentences about the trip and what to watch'),
  checklist: z
    .array(
      z.object({
        text: z.string().describe('One thing to do before leaving, verb first'),
        daysBefore: z
          .number()
          .describe('How many days before departure to do it'),
      }),
    )
    .describe('Up to twelve things to do before the trip'),
  packing: z
    .array(z.string())
    .describe('Up to twenty things to pack for this destination and season'),
  days: z
    .array(
      z.object({
        day: z.string().describe('Day 1, Day 2…'),
        plan: z.string().describe('What to do that day, in one or two sentences'),
      }),
    )
    .describe('A loose plan per day, at most fourteen days'),
  budgetTips: z.array(z.string()).describe('Up to three ways to spend less'),
});
export type TripPlanOutput = z.infer<typeof tripPlanOutputSchema>;
export type TripPlanDto = LifeAiAnswerDto<TripPlanOutput> & { tripId: string };

export const tripPlanRequestSchema = z.object({
  question: z.string().trim().max(1000).nullable().optional(),
});
export type TripPlanRequest = z.input<typeof tripPlanRequestSchema>;

/** Adds the plan's checklist or packing list to the trip. */
export const applyTripPlanRequestSchema = z.object({
  checklist: z.boolean().optional(),
  packing: z.boolean().optional(),
});
export type ApplyTripPlanRequest = z.input<typeof applyTripPlanRequestSchema>;

export interface TravelOverviewDto {
  today: string;
  trips: TripDto[];
  plans: TripPlanDto[];
  totals: {
    upcoming: number;
    spentThisYear: number;
    nightsThisYear: number;
  };
  aiPlanner: boolean;
}
