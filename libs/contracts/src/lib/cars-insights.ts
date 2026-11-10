import { z } from 'zod';

/*
 * What Cars works out from a car's documents beyond renewals and costs: how
 * far and how efficiently it is driven (odometer and fuel), how its insurance
 * changed policy after policy, its fines with their legal deadlines, its tyre
 * sets with the winter-tyre rules, and the AI comparison of insurance quotes.
 */

// ---------------------------------------------------------------------------
// Odometer and fuel.

/** One km reading printed on an approved document. */
export interface OdometerReadingDto {
  uploadId: string;
  title: string;
  date: string;
  km: number;
  /** Lower than a reading of an earlier day: a misread, or a wound-back odometer. */
  anomaly: boolean;
}

/** One fuel receipt with litres. */
export interface FuelFillDto {
  uploadId: string;
  date: string;
  litres: number;
  amount: number;
  pricePerLitre: number;
  odometerKm: number | null;
  /**
   * Litres of this fill over the km since the previous fill with km, as if
   * every fill topped the tank up: null for the first one or without km.
   */
  litresPer100Km: number | null;
}

export interface CarUsageDto {
  /** Oldest first. */
  readings: OdometerReadingDto[];
  /** Km a year, from the first and the last reading that are not anomalies. */
  kmPerYear: number | null;
  /** Today's km, from the last reading and the km a year. */
  estimatedKm: number | null;
  /** Newest first. */
  fills: FuelFillDto[];
  /** Litres over the km between the first and the last fill with km. */
  litresPer100Km: number | null;
  /** V.8 of the card: the combined consumption it was approved with. */
  officialLitresPer100Km: number | null;
  /** Average € per litre over the last 12 months of fills (else all). */
  pricePerLitre: number | null;
  /** Fuel € per km, from the consumption and the price. */
  fuelCostPerKm: number | null;
  /** Everything the car cost in the last 12 months. */
  costLast12Months: number;
  /** That, over the km a year. */
  costPerKm: number | null;
}

// ---------------------------------------------------------------------------
// Insurance history.

/** One insurance record (a policy period) with what changed since the one before. */
export interface InsurancePeriodDto {
  uploadId: string;
  insurer: string | null;
  number: string | null;
  validFrom: string | null;
  validUntil: string | null;
  /** What the record cost: its payments, else the premium it prints. */
  premium: number | null;
  /** Bonus-malus (CU) class: 1 is the best, 18 the worst. */
  cuClass: number | null;
  coverages: string[];
  /** Against the period before: null for the first, or when one side has no figure. */
  premiumChange: number | null;
  /** Positive is a worse class. */
  cuClassChange: number | null;
  added: string[];
  removed: string[];
  cancelled: boolean;
}

export type InsuranceNoteTone = 'info' | 'warning' | 'success';

export interface InsuranceNoteDto {
  tone: InsuranceNoteTone;
  text: string;
}

export interface InsuranceHistoryDto {
  /** Newest first. */
  periods: InsurancePeriodDto[];
  /** What changed in the latest renewal worth knowing. */
  notes: InsuranceNoteDto[];
}

// ---------------------------------------------------------------------------
// Fines.

/** Discount 30% within 5 days of notification (art. 202 Codice della Strada). */
export const FINE_DISCOUNT_DAYS = 5;
export const FINE_DISCOUNT_RATE = 0.3;
/** Pay, appeal to the Prefetto, or name the driver within 60 days. */
export const FINE_PAY_DAYS = 60;
/** Appeal to the Giudice di pace within 30 days (art. 204-bis). */
export const FINE_JUDGE_APPEAL_DAYS = 30;
/** Licence points stay on record for 2 years. */
export const FINE_POINTS_YEARS = 2;

export type FineStage = 'discount' | 'due' | 'late' | 'paid' | 'unknown';
export const FINE_STAGE_LABELS: Record<FineStage, string> = {
  discount: '30% off',
  due: 'To pay',
  late: 'Late',
  paid: 'Paid',
  unknown: 'Notification date missing',
};

export interface CarFineDto {
  uploadId: string;
  title: string;
  /** The police or municipality that issued it. */
  authority: string | null;
  number: string | null;
  /** The rule broken, as printed (art. 142 c. 8...). */
  article: string | null;
  violationDate: string | null;
  /** When it reached you: the start of every deadline. */
  notifiedOn: string | null;
  paidOn: string | null;
  /** The amount printed, the full minimum one. */
  amount: number | null;
  /** The amount within 5 days, printed or worked out (30% off). */
  reducedAmount: number | null;
  points: number | null;
  /** Who was driving: a person of People, or a typed name. */
  driverPersonId: string | null;
  driverName: string | null;
  stage: FineStage;
  discountUntil: string | null;
  payBy: string | null;
  judgeAppealBy: string | null;
  prefectAppealBy: string | null;
  /** When points go and no driver is set: name the driver by this date (art. 126-bis). */
  driverBy: string | null;
}

/** Licence points a driver lost to the car's fines of the last 2 years. */
export interface DriverPointsDto {
  driverName: string;
  driverPersonId: string | null;
  points: number;
  fines: number;
}

export interface CarFinesDto {
  fines: CarFineDto[];
  points: DriverPointsDto[];
}

const isoDate = z.iso.date();

/** What you add to a fine by hand: when it reached you, when you paid, who drove. */
export const updateFineRequestSchema = z.object({
  notifiedOn: isoDate.nullable().optional(),
  paidOn: isoDate.nullable().optional(),
  points: z.number().int().min(0).max(20).nullable().optional(),
  driverPersonId: z.uuid().nullable().optional(),
  driverName: z.string().trim().max(120).nullable().optional(),
});
export type UpdateFineRequest = z.input<typeof updateFineRequestSchema>;

// ---------------------------------------------------------------------------
// Tyres.

export const TYRE_SEASONS = ['summer', 'winter', 'all_season'] as const;
export type TyreSeason = (typeof TYRE_SEASONS)[number];
export const TYRE_SEASON_LABELS: Record<TyreSeason, string> = {
  summer: 'Summer',
  winter: 'Winter',
  all_season: 'All-season',
};

/** km/h of each speed index letter (the last character of the size). */
export const TYRE_SPEED_INDEX_KMH: Record<string, number> = {
  L: 120,
  M: 130,
  N: 140,
  P: 150,
  Q: 160,
  R: 170,
  S: 180,
  T: 190,
  U: 200,
  H: 210,
  V: 240,
  W: 270,
  Y: 300,
};

/** Legal minimum tread (mm). */
export const TYRE_MIN_TREAD_MM = 1.6;
/** Below this a winter tyre grips little on snow; a summer one in the wet. */
export const TYRE_WINTER_TREAD_MM = 4;
export const TYRE_SUMMER_TREAD_MM = 3;
/** Rubber hardens with age: check after 6 years, replace after 10. */
export const TYRE_CHECK_AGE_YEARS = 6;
export const TYRE_REPLACE_AGE_YEARS = 10;

export type TyreNoteTone = 'ok' | 'warning' | 'danger';

export interface TyreNoteDto {
  tone: TyreNoteTone;
  text: string;
}

export interface TyreSetDto {
  id: string;
  season: TyreSeason;
  label: string | null;
  /** As printed on the sidewall: 205/55 R16 91H. */
  size: string | null;
  /** DOT week and year: 2321 is week 23 of 2021. */
  dot: string | null;
  purchasedOn: string | null;
  treadMm: number | null;
  mounted: boolean;
  storedAt: string | null;
  notes: string | null;
  /** From the DOT code. */
  ageYears: number | null;
  speedIndex: string | null;
  speedKmh: number | null;
  /** Age, tread, speed index against the card. */
  checks: TyreNoteDto[];
}

const tyreFields = {
  season: z.enum(TYRE_SEASONS),
  label: z.string().trim().max(60).nullable().optional(),
  size: z.string().trim().max(40).nullable().optional(),
  dot: z
    .string()
    .trim()
    .regex(/^\d{4}$/, 'DOT is four digits: week and year (2321)')
    .nullable()
    .optional(),
  purchasedOn: isoDate.nullable().optional(),
  treadMm: z.number().min(0).max(20).nullable().optional(),
  mounted: z.boolean().optional(),
  storedAt: z.string().trim().max(120).nullable().optional(),
  notes: z.string().trim().max(500).nullable().optional(),
};

export const createTyreSetRequestSchema = z.object(tyreFields);
export type CreateTyreSetRequest = z.input<typeof createTyreSetRequestSchema>;

export const updateTyreSetRequestSchema = z.object(tyreFields).partial();
export type UpdateTyreSetRequest = z.input<typeof updateTyreSetRequestSchema>;

// ---------------------------------------------------------------------------
// Insurance quote comparison (AI tool cars.insurance-quotes).

export const QUOTE_MAX_FILES = 4;
export const QUOTE_MAX_BYTES = 10 * 1024 * 1024;
export const QUOTE_CONTENT_TYPES = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
] as const;

export const COVER_STATUSES = [
  'included',
  'optional',
  'missing',
  'unknown',
] as const;
export type CoverStatus = (typeof COVER_STATUSES)[number];

export const quoteComparisonOutputSchema = z.object({
  summary: z
    .string()
    .describe(
      'Two or three sentences: which offer is best for this car and why, in plain words',
    ),
  options: z
    .array(
      z.object({
        name: z
          .string()
          .describe(
            'Short name: "Current policy" for the current one, else the insurer and product',
          ),
        current: z.boolean().describe('True only for the current policy'),
        insurer: z.string().nullable(),
        yearlyPremium: z
          .number()
          .nullable()
          .describe('Total premium for a year in euros, taxes included'),
        cuClass: z
          .number()
          .nullable()
          .describe('Bonus-malus class (CU) the price assumes'),
        driverType: z
          .string()
          .nullable()
          .describe(
            'Who may drive: any driver, expert driver, exclusive driver...',
          ),
        rcaLimit: z
          .string()
          .nullable()
          .describe('Massimale RCA as printed (e.g. 7.750.000 €)'),
        excess: z
          .string()
          .nullable()
          .describe('Franchigia or scoperto of the main covers, in short'),
        pros: z.array(z.string()),
        cons: z.array(z.string()),
      }),
    )
    .describe('The current policy first, then one entry per quote'),
  covers: z
    .array(
      z.object({
        name: z
          .string()
          .describe(
            'A cover in plain English: Theft and fire, Natural events, Glass, Roadside assistance, Driver injury, Legal protection, Collision (kasko), Bonus protection...',
          ),
        statuses: z
          .array(
            z.object({
              status: z.enum(COVER_STATUSES),
              detail: z
                .string()
                .nullable()
                .describe('Limit, excess or condition, in a few words'),
            }),
          )
          .describe('One per option, in the same order as options'),
      }),
    )
    .describe('Every cover that appears in at least one option'),
  watchOuts: z
    .array(z.string())
    .describe(
      'Exclusions, conditions or differences that could cost money: driver limits, black box, excess, renewal tacita...',
    ),
  questions: z
    .array(z.string())
    .describe('What to ask the insurer before signing'),
  recommendation: z
    .string()
    .describe('What to do now, in one or two sentences'),
});
export type QuoteComparisonOutput = z.infer<typeof quoteComparisonOutputSchema>;

export interface QuoteComparisonDto extends QuoteComparisonOutput {
  id: string;
  vehicleId: string;
  /** The names of the quote files compared (the files are not kept). */
  files: string[];
  note: string | null;
  model: string | null;
  createdAt: string;
}
