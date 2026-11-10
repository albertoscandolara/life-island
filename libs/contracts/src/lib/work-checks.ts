import { z } from 'zod';
import {
  FOI_ANNUAL_CHANGE_PCT,
  grossIrpef,
  marginalBracket,
} from './work-insights.js';

/*
 * More of Work's career analysis: the CCNL rules a payslip is audited
 * against, the TFR revaluation, the pension fund rules for the TFR choice,
 * and the job search tracker. Reference figures are copied with their
 * source; update them when a year or a renewal changes them.
 */

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// ---------------------------------------------------------------------------
// CCNL Metalmeccanici industria: the rules beyond the minimum pay.

/** Monthly amount of one biennial seniority increment (scatto), by level. */
export const METALMECCANICI_SENIORITY_STEP: Readonly<Record<string, number>> = {
  D1: 21.59,
  D2: 25.05,
  C1: 25.05,
  C2: 26.75,
  C3: 29.64,
  B1: 32.43,
  B2: 36.41,
  B3: 40.96,
  A1: 40.96,
};
/** Increments mature every two years at the same company, five at most. */
export const SENIORITY_STEP_MONTHS = 24;
export const SENIORITY_STEPS_MAX = 5;

/** Vacation hours a year for a 40-hour week, by years at the company. */
export function vacationHoursPerYear(yearsOfService: number): number {
  if (yearsOfService > 18) return 200;
  if (yearsOfService > 10) return 168;
  return 160;
}
/** PAR (ROL and ex festività) hours a year, outside the steel sector and shifts. */
export const PAR_HOURS_PER_YEAR = 104;
/** Vacation beyond two weeks is taken within 18 months of the end of its year. */
export const VACATION_DEADLINE_MONTHS = 18;
/** Unused PAR hours stay in your hours account for 24 months, then are paid. */
export const PAR_ACCOUNT_MONTHS = 24;

export const CCNL_RULES_SOURCES = [
  {
    label: 'Seniority increments by level (businessonline.it)',
    url: 'https://www.businessonline.it/articoli/scatti-di-anzianita-e-livello-contratto-metalmeccanici-industria-ccnl-ogni-quanto-avvengono-e-come-aumenta-stipendio.html',
  },
  {
    label: 'Vacation and PAR in the Metalmeccanici CCNL (leggeinchiaro.it)',
    url: 'https://leggeinchiaro.it/ccnl-metalmeccanici-industria-ferie-permessi-rol/',
  },
];

// ---------------------------------------------------------------------------
// TFR: the yearly revaluation of the severance kept by the company.

/**
 * The official revaluation of the TFR kept by the company over each year
 * (1.5% plus 75% of the FOI change December on December), in percent.
 */
export const TFR_REVALUATION_PCT: Readonly<Record<number, number>> = {
  2021: 4.359238,
  2022: 9.974576,
  2023: 1.944162,
  2024: 2.320017,
  2025: 2.311148,
};
/** Substitute tax on the revaluation, withheld from the fund each year. */
export const TFR_REVALUATION_TAX_PCT = 17;
/** Each year's TFR is the year's pay divided by 13.5. */
export const TFR_DIVISOR = 13.5;
export const TFR_SOURCE = {
  label: 'ISTAT TFR revaluation coefficients (dottrinalavoro.it, edotto.com)',
  url: 'https://www.dottrinalavoro.it/notizie-c/tfr-aggiornato-il-coefficiente-di-rivalutazione-per-il-mese-di-dicembre-2025',
};

/**
 * The revaluation of a year: the official one, else estimated from the
 * year's average inflation (the official one uses December on December).
 */
export function tfrRevaluation(year: number): {
  pct: number;
  estimated: boolean;
} {
  const official = TFR_REVALUATION_PCT[year];
  if (official !== undefined) return { pct: official, estimated: false };
  const inflation = FOI_ANNUAL_CHANGE_PCT[year] ?? 2;
  return {
    pct: round2(1.5 + 0.75 * Math.max(0, inflation)),
    estimated: true,
  };
}

/**
 * The tax on a TFR paid by the company when you leave (tassazione separata):
 * IRPEF on the yearly "reference income" (the TFR over the years it took,
 * times 12) at its average rate. The Agenzia then recomputes it on the
 * average rate of your last five years, so it is an estimate.
 */
export function tfrSeparateTaxRate(
  tfr: number,
  years: number,
  year: number,
): number {
  if (tfr <= 0 || years <= 0) return 0;
  const reference = (tfr / years) * 12;
  return round2((grossIrpef(reference, year) / reference) * 100);
}

// ---------------------------------------------------------------------------
// Pension fund rules, for the TFR choice.

/** Contributions you can deduct from your income a year, the TFR excluded. */
export function pensionDeductionLimit(year: number): number {
  return year >= 2026 ? 5300 : 5164.57;
}
/** Tax on a pension fund's benefit: 15%, less 0.3 points a year after the 15th, down to 9%. */
export function pensionFundBenefitTaxPct(yearsMember: number): number {
  return Math.max(9, 15 - 0.3 * Math.max(0, Math.floor(yearsMember) - 15));
}
export const PENSION_FUND_SOURCE = {
  label: 'Fondo Cometa, tax advantages',
  url: 'https://www.cometafondo.it/prestazioni-contribuzione/vantaggi-fiscali/',
};

export interface TfrChoiceInput {
  /** Yearly gross salary (RAL) today. */
  ral: number;
  /** Years until you retire or leave. */
  years: number;
  /** TFR already set aside, kept by the company. */
  startingTfr: number;
  /** Your contribution to the fund, in percent of the RAL. */
  employeePct: number;
  /** The employer contribution, in percent of the RAL (paid only if you join). */
  employerPct: number;
  /** Expected yearly return of the fund, net of its costs and of the 20% tax on returns. */
  fundReturnPct: number;
  /** Expected yearly inflation, which sets the TFR revaluation. */
  inflationPct: number;
  /** Expected yearly growth of your salary, in percent. */
  salaryGrowthPct: number;
  year: number;
}

export interface TfrChoiceResult {
  company: {
    /** Before the tax at exit. */
    gross: number;
    taxPct: number;
    net: number;
  };
  fund: {
    gross: number;
    taxPct: number;
    net: number;
    /** Your contributions and the employer's, over the years. */
    paidIn: number;
    employerPaidIn: number;
    /** Income tax you saved by deducting your contributions, over the years. */
    taxSaved: number;
  };
  /** Fund (net, with the tax saved) less company (net). */
  difference: number;
  /** The yearly revaluation of the TFR kept by the company, after its 17% tax. */
  companyRatePct: number;
}

/**
 * Leave the TFR with the company, or send it to a pension fund with your
 * contribution and the employer's? Yearly steps from today, at constant
 * rules: an estimate to compare, not a promise (fund returns are not
 * guaranteed, and the TFR already set aside stays with the company).
 */
export function compareTfrChoice(input: TfrChoiceInput): TfrChoiceResult {
  const years = Math.max(1, Math.round(input.years));
  const revaluation = (1.5 + 0.75 * Math.max(0, input.inflationPct)) / 100;
  const companyRate = revaluation * (1 - TFR_REVALUATION_TAX_PCT / 100);
  const fundRate = input.fundReturnPct / 100;
  let ral = input.ral;
  let company = input.startingTfr;
  let companyQuotas = input.startingTfr;
  // The TFR already set aside grows in the company in both cases.
  let kept = input.startingTfr;
  let fund = 0;
  let principal = 0;
  let paidIn = 0;
  let employerPaidIn = 0;
  let taxSaved = 0;
  for (let i = 0; i < years; i++) {
    const quota = ral / TFR_DIVISOR;
    const employee = (ral * input.employeePct) / 100;
    const employer = (ral * input.employerPct) / 100;
    company = company * (1 + companyRate) + quota;
    companyQuotas += quota;
    kept = kept * (1 + companyRate);
    fund = fund * (1 + fundRate) + quota + employee + employer;
    principal += quota + employee + employer;
    paidIn += employee;
    employerPaidIn += employer;
    const deductible = Math.min(
      employee + employer,
      pensionDeductionLimit(input.year + i),
    );
    const share =
      employee + employer > 0 ? employee / (employee + employer) : 0;
    taxSaved +=
      (deductible * share * marginalBracket(ral - quota, input.year).ratePct) /
      100;
    ral *= 1 + input.salaryGrowthPct / 100;
  }
  const companyTax = tfrSeparateTaxRate(companyQuotas, years, input.year);
  const keptTax = tfrSeparateTaxRate(
    input.startingTfr,
    Math.max(1, years),
    input.year,
  );
  const fundTax = pensionFundBenefitTaxPct(years);
  const companyNet = company * (1 - companyTax / 100);
  // What was paid in is taxed at exit; the returns were taxed every year.
  const fundTaxable = Math.min(fund, principal);
  const fundNet =
    fund - (fundTaxable * fundTax) / 100 + kept * (1 - keptTax / 100);
  return {
    company: {
      gross: round2(company),
      taxPct: companyTax,
      net: round2(companyNet),
    },
    fund: {
      gross: round2(fund + kept),
      taxPct: fundTax,
      net: round2(fundNet),
      paidIn: round2(paidIn),
      employerPaidIn: round2(employerPaidIn),
      taxSaved: round2(taxSaved),
    },
    difference: round2(fundNet + taxSaved - companyNet),
    companyRatePct: round2(companyRate * 100),
  };
}

// ---------------------------------------------------------------------------
// What svc-work computes: the payslip audit, the net explained, the TFR.

export const AUDIT_SEVERITIES = ['problem', 'check', 'info'] as const;
export type AuditSeverity = (typeof AUDIT_SEVERITIES)[number];

export const AUDIT_KINDS = [
  'below_minimum',
  'seniority_count',
  'seniority_amount',
  'next_increment',
  'superminimum_absorbed',
  'vacation_backlog',
  'par_backlog',
  'thirteenth_amount',
  'tfr_quota',
  'contribution_rate',
] as const;
export type AuditKind = (typeof AUDIT_KINDS)[number];

/** Something a payslip shows that the CCNL rules or the other payslips question. */
export interface PayslipAuditFindingDto {
  kind: AuditKind;
  severity: AuditSeverity;
  /** The payslip it is about, if one. */
  uploadId: string | null;
  period: string | null;
  title: string;
  detail: string;
  /** Euros (or hours, for time off) involved, when the check gives a figure. */
  amount: number | null;
}

export interface PayslipAuditDto {
  agreement: string | null;
  /** Whether Life Island has the rules of your CCNL (Metalmeccanici industria only). */
  rulesKnown: boolean;
  checkedPayslips: number;
  findings: PayslipAuditFindingDto[];
  /** The checks that found nothing to say, in words. */
  passed: string[];
  sources: { label: string; url: string }[];
}

/** One reason the net changed from one month to the next, signed as its effect on the net. */
export interface NetChangePartDto {
  label: string;
  amount: number;
}

export interface NetChangeDto {
  uploadId: string;
  period: string;
  previousPeriod: string;
  net: number;
  previousNet: number;
  change: number;
  /** Largest effect first; they add up to the change. */
  parts: NetChangePartDto[];
}

export interface TfrYearDto {
  year: number;
  payslips: number;
  /** TFR accrued on the year's payslips. */
  accrued: number;
  /** Of which sent to a pension fund. */
  toFund: number;
  /** The year's pay divided by 13.5, to set against what was accrued. */
  expected: number | null;
  revaluationPct: number;
  revaluationEstimated: boolean;
  /** Revaluation of what the company held at the start of the year, before its tax. */
  revaluation: number;
  revaluationTax: number;
  /** What the company holds at the end of the year, from your payslips only. */
  companyFund: number;
}

export interface TfrDto {
  years: TfrYearDto[];
  /** What the company holds now, from the payslips on record. */
  companyFund: number;
  /** TFR sent to a pension fund, and the contributions on record. */
  fundTotal: number;
  employeeContributions: number;
  employerContributions: number;
  /** Whether any payslip shows a pension fund. */
  inFund: boolean;
  /** Your RAL and TFR quota now, to start the comparison. */
  ral: number | null;
  /** Estimated tax if the company paid it today. */
  separateTaxPct: number | null;
  firstPeriod: string | null;
  source: { label: string; url: string };
}

// ---------------------------------------------------------------------------
// Job search.

export const JOB_APPLICATION_STATUSES = [
  'saved',
  'applied',
  'screening',
  'interview',
  'offer',
  'accepted',
  'rejected',
  'withdrawn',
] as const;
export type JobApplicationStatus = (typeof JOB_APPLICATION_STATUSES)[number];
export const JOB_APPLICATION_STATUS_LABELS: Record<
  JobApplicationStatus,
  string
> = {
  saved: 'Saved',
  applied: 'Applied',
  screening: 'First call',
  interview: 'Interviews',
  offer: 'Offer',
  accepted: 'Accepted',
  rejected: 'Rejected',
  withdrawn: 'Withdrawn',
};
/** Still going: the ones you are waiting on or working on. */
export const ACTIVE_JOB_STATUSES: readonly JobApplicationStatus[] = [
  'saved',
  'applied',
  'screening',
  'interview',
  'offer',
];
/** An application with no news for this long is stale. */
export const JOB_APPLICATION_STALE_DAYS = 21;

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');
const amount = z.number().min(0).max(10_000_000).nullable().optional();

export const jobApplicationRequestSchema = z.object({
  company: z.string().trim().min(1).max(200),
  role: z.string().trim().min(1).max(200),
  source: z.string().trim().max(200).nullable().optional(),
  url: z
    .string()
    .trim()
    .max(1000)
    .refine((url) => /^https?:\/\/\S+$/i.test(url), {
      message: 'Use a web address starting with https://',
    })
    .nullable()
    .optional(),
  location: z.string().trim().max(200).nullable().optional(),
  status: z.enum(JOB_APPLICATION_STATUSES).optional(),
  appliedAt: isoDate.nullable().optional(),
  nextStep: z.string().trim().max(500).nullable().optional(),
  nextStepAt: isoDate.nullable().optional(),
  ralMin: amount,
  ralMax: amount,
  /** The offer, once there is one. */
  offerRal: amount,
  offerMonths: z
    .union([z.literal(13), z.literal(14)])
    .nullable()
    .optional(),
  offerWelfare: amount,
  offerBonus: amount,
  notes: z.string().trim().max(4000).nullable().optional(),
});
export type JobApplicationRequest = z.input<typeof jobApplicationRequestSchema>;

export interface JobApplicationDto {
  id: string;
  company: string;
  role: string;
  source: string | null;
  url: string | null;
  location: string | null;
  status: JobApplicationStatus;
  appliedAt: string | null;
  nextStep: string | null;
  nextStepAt: string | null;
  ralMin: number | null;
  ralMax: number | null;
  offerRal: number | null;
  offerMonths: 13 | 14 | null;
  offerWelfare: number | null;
  offerBonus: number | null;
  notes: string | null;
  /** Every status it went through, oldest first. */
  history: { status: JobApplicationStatus; at: string }[];
  /** Days since the last change, for an active one. */
  idleDays: number | null;
  stale: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface JobSearchStatsDto {
  total: number;
  active: number;
  /** Applications sent (anything past saved). */
  sent: number;
  /** Of those sent, how many got any answer (a call, interviews, an offer or a no). */
  answered: number;
  responseRatePct: number | null;
  interviews: number;
  offers: number;
  /** Days from applying to the first answer, on average. */
  averageDaysToAnswer: number | null;
  stale: number;
}
