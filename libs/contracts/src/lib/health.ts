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
 * Health (Maia, svc-health, mfe-health): the visits of everyone at home and
 * what they cost, medicines and when to refill them, test results with their
 * trend, vaccinations and the checkups that come round every few years, and
 * an AI that explains test results in plain words (never a diagnosis).
 */

export const VISIT_KINDS = [
  'gp',
  'specialist',
  'dentist',
  'exam',
  'emergency',
  'therapy',
  'other',
] as const;
export type VisitKind = (typeof VISIT_KINDS)[number];
export const VISIT_KIND_LABELS: Record<VisitKind, string> = {
  gp: 'Family doctor',
  specialist: 'Specialist',
  dentist: 'Dentist',
  exam: 'Exam or scan',
  emergency: 'Emergency room',
  therapy: 'Therapy or physio',
  other: 'Other',
};

export const visitRequestSchema = z.object({
  date: lifeDate,
  person: lifeName(80),
  kind: z.enum(VISIT_KINDS).optional(),
  doctor: lifeNote(120),
  reason: lifeNote(500),
  outcome: lifeNote(2000),
  cost: lifeAmount.nullable().optional(),
  /** A health expense you can deduct in the 730 (keep the receipt). */
  deductible: z.boolean().optional(),
  followUpOn: lifeOptionalDate,
});
export type VisitRequest = z.input<typeof visitRequestSchema>;

export const medicineRequestSchema = z.object({
  person: lifeName(80),
  name: lifeName(120),
  dose: lifeNote(120),
  /** When to take it, in words: "1 in the morning". */
  schedule: lifeNote(200),
  startOn: lifeOptionalDate,
  endOn: lifeOptionalDate,
  /** When the box or the prescription runs out. */
  refillOn: lifeOptionalDate,
  active: z.boolean().optional(),
  notes: lifeNote(500),
});
export type MedicineRequest = z.input<typeof medicineRequestSchema>;

export const testResultRequestSchema = z.object({
  date: lifeDate,
  person: lifeName(80),
  test: lifeName(120),
  value: z.number().min(-1_000_000).max(1_000_000),
  unit: lifeNote(40),
  low: z.number().nullable().optional(),
  high: z.number().nullable().optional(),
  notes: lifeNote(500),
});
export type TestResultRequest = z.input<typeof testResultRequestSchema>;

export const vaccinationRequestSchema = z.object({
  person: lifeName(80),
  name: lifeName(120),
  date: lifeDate,
  nextDueOn: lifeOptionalDate,
  notes: lifeNote(500),
});
export type VaccinationRequest = z.input<typeof vaccinationRequestSchema>;

export const checkupRequestSchema = z.object({
  person: lifeName(80),
  name: lifeName(120),
  /** How often it should be done, in months. */
  everyMonths: z.number().int().min(1).max(240),
  lastDoneOn: lifeOptionalDate,
  notes: lifeNote(500),
});
export type CheckupRequest = z.input<typeof checkupRequestSchema>;

export type VisitDto = LifeRecord<{
  date: string;
  person: string;
  kind: VisitKind;
  doctor: string | null;
  reason: string | null;
  outcome: string | null;
  cost: number | null;
  deductible: boolean;
  followUpOn: string | null;
}>;

export type MedicineDto = LifeRecord<{
  person: string;
  name: string;
  dose: string | null;
  schedule: string | null;
  startOn: string | null;
  endOn: string | null;
  refillOn: string | null;
  active: boolean;
  notes: string | null;
}>;

export type TestResultDto = LifeRecord<{
  date: string;
  person: string;
  test: string;
  value: number;
  unit: string | null;
  low: number | null;
  high: number | null;
  notes: string | null;
}> & { flag: 'low' | 'high' | 'normal' | 'unknown' };

export type VaccinationDto = LifeRecord<{
  person: string;
  name: string;
  date: string;
  nextDueOn: string | null;
  notes: string | null;
}>;

export type CheckupDto = LifeRecord<{
  person: string;
  name: string;
  everyMonths: number;
  lastDoneOn: string | null;
  notes: string | null;
}> & {
  /** Last done plus the interval; today when it was never done. */
  nextDueOn: string;
  overdue: boolean;
};

/** One test of one person over time, for its trend. */
export interface TestSeriesDto {
  person: string;
  test: string;
  unit: string | null;
  low: number | null;
  high: number | null;
  points: { date: string; value: number; flag: TestResultDto['flag'] }[];
  trend: 'up' | 'down' | 'steady' | null;
}

/** Common screenings to add in one click; adjust to your doctor's advice. */
export const SUGGESTED_CHECKUPS: readonly {
  name: string;
  everyMonths: number;
  note: string;
}[] = [
  { name: 'Dental check and cleaning', everyMonths: 6, note: 'Every 6–12 months' },
  { name: 'Blood tests', everyMonths: 12, note: 'Yearly, or as your doctor says' },
  { name: 'Eye exam', everyMonths: 24, note: 'Every 1–2 years' },
  { name: 'Blood pressure', everyMonths: 12, note: 'At least yearly after 40' },
  { name: 'Skin check (moles)', everyMonths: 12, note: 'Yearly' },
  { name: 'Pap test / HPV test', everyMonths: 36, note: 'Every 3–5 years (25–64)' },
  { name: 'Mammography', everyMonths: 24, note: 'Every 2 years (50–69)' },
  { name: 'Colon screening (FOBT)', everyMonths: 24, note: 'Every 2 years (50–69)' },
];

export const resultsExplainerOutputSchema = z.object({
  summary: z
    .string()
    .describe('Two or three plain sentences about the results as a whole'),
  items: z
    .array(
      z.object({
        test: z.string().describe('The test name, as written'),
        meaning: z
          .string()
          .describe('What this test measures and what this value suggests, in plain words'),
        trend: z
          .string()
          .describe('How it moved over time, or empty with one reading'),
      }),
    )
    .describe('One entry per test that is out of range or changing, at most eight'),
  askTheDoctor: z
    .array(z.string())
    .describe('Up to five questions worth asking the doctor'),
  lifestyle: z
    .array(z.string())
    .describe('Up to three general, safe habits related to these tests'),
});
export type ResultsExplainerOutput = z.infer<
  typeof resultsExplainerOutputSchema
>;
export type ResultsExplanationDto = LifeAiAnswerDto<ResultsExplainerOutput> & {
  person: string | null;
};

export const resultsExplainRequestSchema = z.object({
  person: z.string().trim().max(80).nullable().optional(),
  question: z.string().trim().max(1000).nullable().optional(),
});
export type ResultsExplainRequest = z.input<typeof resultsExplainRequestSchema>;

export interface HealthOverviewDto {
  today: string;
  people: string[];
  visits: VisitDto[];
  medicines: MedicineDto[];
  results: TestResultDto[];
  series: TestSeriesDto[];
  vaccinations: VaccinationDto[];
  checkups: CheckupDto[];
  costs: {
    year: number;
    total: number;
    deductible: number;
  };
  explanations: ResultsExplanationDto[];
  aiExplainer: boolean;
}

/** Whether a value is inside its range. */
export function resultFlag(
  value: number,
  low: number | null,
  high: number | null,
): TestResultDto['flag'] {
  if (low === null && high === null) return 'unknown';
  if (low !== null && value < low) return 'low';
  if (high !== null && value > high) return 'high';
  return 'normal';
}
