import { z } from 'zod';
import {
  lifeAmount,
  lifeDate,
  lifeName,
  lifeNote,
  lifeOptionalDate,
  lifeUrl,
} from './life-schemas.js';
import {
  pensionDeductionLimit,
  pensionFundBenefitTaxPct,
} from './work-checks.js';

/*
 * Pension fund (fondo pensione, previdenza complementare), in Work (Pachy):
 * the funds you belong to, what your payslips and your own transfers paid
 * into them year by year against the yearly deduction limit, the value of
 * your position read from the fund's statements, and what the 730 and the
 * fund need from you (rigo E27, the non-deducted contributions notice).
 * The figures are estimates for planning; the fund and the CAF decide.
 */

export const PENSION_FUND_KINDS = ['negotiated', 'open', 'pip'] as const;
export type PensionFundKind = (typeof PENSION_FUND_KINDS)[number];
export const PENSION_FUND_KIND_LABELS: Record<PensionFundKind, string> = {
  negotiated: 'Contract fund (fondo negoziale, e.g. Cometa)',
  open: 'Open fund (fondo aperto)',
  pip: 'Individual plan (PIP)',
};

export const PENSION_FUND_STATUSES = ['active', 'closed'] as const;
export type PensionFundStatus = (typeof PENSION_FUND_STATUSES)[number];

/** A payment you made to the fund yourself, outside the payslip. */
export const PENSION_PAYMENT_KINDS = ['direct', 'family'] as const;
export type PensionPaymentKind = (typeof PENSION_PAYMENT_KINDS)[number];
export const PENSION_PAYMENT_KIND_LABELS: Record<PensionPaymentKind, string> = {
  direct: 'Your own transfer',
  family: 'For a dependent family member',
};

/**
 * Template keys of a pension fund statement (PENSION_FUND_STATEMENT,
 * svc-ingestion migration 0027): the yearly "comunicazione periodica" or an
 * "estratto conto" of the fund.
 */
export const PENSION_STATEMENT_KEYS = {
  fundName: 'fund_name',
  statementDate: 'statement_date',
  year: 'statement_year',
  value: 'position_value',
  paidIn: 'total_paid_in',
  employee: 'employee_contributions',
  employer: 'employer_contributions',
  tfr: 'tfr_contributions',
  investmentLine: 'investment_line',
  memberSince: 'member_since',
  returnPct: 'year_return',
} as const;

/** The document type of a fund statement, in the category tree. */
export const PENSION_STATEMENT_CATEGORY = 'PENSION_FUND_STATEMENT';

const percent = z.number().min(0).max(100).nullable().optional();

export const pensionFundRequestSchema = z.object({
  name: lifeName(120),
  kind: z.enum(PENSION_FUND_KINDS).optional(),
  /** First day in any pension fund: it sets the tax at exit (transfers keep it). */
  memberSince: lifeOptionalDate,
  /** The investment line (comparto), as the fund names it. */
  investmentLine: lifeNote(120),
  employeePct: percent,
  employerPct: percent,
  /** Share of your TFR that goes to the fund (100 for most workers). */
  tfrPct: percent,
  /** First job after 1 January 2007: a larger deduction from the 6th year. */
  firstJob: z.boolean().optional(),
  memberCode: lifeNote(60),
  url: lifeUrl,
  notes: lifeNote(2000),
  status: z.enum(PENSION_FUND_STATUSES).optional(),
});
export type PensionFundRequest = z.input<typeof pensionFundRequestSchema>;

export const pensionStatementRequestSchema = z.object({
  fundId: z.string().uuid(),
  date: lifeDate,
  /** What your position is worth on that date. */
  value: lifeAmount,
  /** Everything paid in since you joined, as the statement prints it. */
  paidIn: lifeAmount.nullable().optional(),
  /** The year's contributions it shows. */
  employee: lifeAmount.nullable().optional(),
  employer: lifeAmount.nullable().optional(),
  tfr: lifeAmount.nullable().optional(),
  /** The line's return in the year, in percent (can be negative). */
  returnPct: z.number().min(-100).max(100).nullable().optional(),
  notes: lifeNote(2000),
});
export type PensionStatementRequest = z.input<
  typeof pensionStatementRequestSchema
>;

export const pensionPaymentRequestSchema = z.object({
  fundId: z.string().uuid(),
  date: lifeDate,
  amount: z.number().positive().max(1_000_000),
  kind: z.enum(PENSION_PAYMENT_KINDS).optional(),
  note: lifeNote(500),
});
export type PensionPaymentRequest = z.input<typeof pensionPaymentRequestSchema>;

/** When you told the fund what you did not deduct for a year (null: not yet). */
export const pensionNoticeRequestSchema = z.object({
  sentAt: lifeOptionalDate,
});
export type PensionNoticeRequest = z.input<typeof pensionNoticeRequestSchema>;

/** A statement read from a document: file it under a fund, or a new one made from it. */
export const pensionConfirmStatementRequestSchema = z.object({
  fundId: z.string().uuid().nullable(),
});
export type PensionConfirmStatementRequest = z.input<
  typeof pensionConfirmStatementRequestSchema
>;

// ---------------------------------------------------------------------------
// Rules.

/** By when the fund must know the contributions you did not deduct for `year`. */
export function pensionNoticeDeadline(year: number): string {
  return `${year + 1}-12-31`;
}

/** Whole years in a pension fund on `today`, from the first day you joined one. */
export function pensionYearsMember(
  memberSince: string | null,
  today: string,
): number | null {
  if (!memberSince) return null;
  const [y1, m1, d1] = memberSince.split('-').map(Number);
  const [y2, m2, d2] = today.split('-').map(Number);
  let years = y2 - y1;
  if (m2 < m1 || (m2 === m1 && d2 < d1)) years--;
  return Math.max(0, years);
}

/** The tax on what the fund pays at retirement, after `years` in it (15% down to 9%). */
export function pensionExitTaxPct(years: number | null): number | null {
  return years === null ? null : pensionFundBenefitTaxPct(years);
}

export { pensionDeductionLimit };

/** Where the rules come from, for the page. */
export const PENSION_FUND_SOURCES = [
  {
    label: 'COVIP, the pension fund supervisor',
    url: 'https://www.covip.it/',
  },
  {
    label: 'Fondo Cometa, tax advantages',
    url: 'https://www.cometafondo.it/prestazioni-contribuzione/vantaggi-fiscali/',
  },
  {
    label: 'Budget law 2026: what changes for pension funds (Euroconference)',
    url: 'https://www.ecnews.it/lavoro/prestazioni-assistenziali-e-previdenziali/pensioni/legge-bilancio-2026-novita-previdenza-complementare/',
  },
] as const;

// ---------------------------------------------------------------------------
// What svc-work returns.

export interface PensionFundDto {
  id: string;
  name: string;
  kind: PensionFundKind;
  memberSince: string | null;
  investmentLine: string | null;
  employeePct: number | null;
  employerPct: number | null;
  tfrPct: number | null;
  firstJob: boolean;
  memberCode: string | null;
  url: string | null;
  notes: string | null;
  status: PensionFundStatus;
  createdAt: string;
  /** Whole years since `memberSince`, and the exit tax they give. */
  yearsMember: number | null;
  exitTaxPct: number | null;
  /** The latest statement. */
  value: number | null;
  valueDate: string | null;
  /** Paid in: the latest statement's total, else what Life Island has on record. */
  paidIn: number | null;
  paidInSource: 'statement' | 'records' | null;
  /** Value less paid in. */
  gain: number | null;
  gainPct: number | null;
}

export interface PensionStatementDto {
  id: string;
  fundId: string;
  fundName: string;
  date: string;
  value: number;
  paidIn: number | null;
  employee: number | null;
  employer: number | null;
  tfr: number | null;
  returnPct: number | null;
  sourceUploadId: string | null;
  notes: string | null;
  /** Value less paid in, when the statement prints both. */
  gain: number | null;
}

export interface PensionPaymentDto {
  id: string;
  fundId: string;
  fundName: string;
  date: string;
  amount: number;
  kind: PensionPaymentKind;
  note: string | null;
}

/** One tax year: what went into the fund and how much of it you can deduct. */
export interface PensionYearDto {
  year: number;
  /** Payslips of the year with a pension fund line. */
  payslips: number;
  /** From the payslips: yours, the employer's, and the TFR sent to the fund. */
  employee: number;
  employer: number;
  tfr: number;
  /** Your own transfers, and those for family members. */
  direct: number;
  family: number;
  /** What counts against the limit: everything but the TFR. */
  counted: number;
  limit: number;
  /** Deduction still free under the limit, and contributions over it. */
  room: number;
  over: number;
  /** From the year's Certificazioni Uniche: deducted by the employer (punto 412) and not (punto 413). */
  cuDeducted: number | null;
  cuNotDeducted: number | null;
  /** The year is still running: `projected` is where the payslips are heading by December. */
  running: boolean;
  projected: number | null;
  /** Your IRPEF bracket that year, and the tax the deduction saves. */
  marginalRatePct: number | null;
  taxSaved: number | null;
  /** In the 730 of the next year, rigo E27: column 1 and column 2. */
  e27Deducted: number;
  e27NotDeducted: number;
  /** Over the limit: tell the fund by `noticeDue`, so it is not taxed again at exit. */
  noticeDue: string | null;
  noticeSentAt: string | null;
}

/** The year now: how much deduction is left and what topping up would save. */
export interface PensionThisYearDto {
  year: number;
  counted: number;
  projected: number;
  limit: number;
  /** Free deduction by December, from the projection. */
  room: number;
  marginalRatePct: number | null;
  /** Income tax a transfer of `room` before 31 December would save. */
  saving: number | null;
  deadline: string;
}

export interface PensionDocumentDto {
  uploadId: string;
  title: string;
  kind: 'statement' | 'certificate' | 'payslip';
  date: string | null;
  summary: string;
}

/** A fund statement read from a document, waiting for you to confirm its figures. */
export interface PendingPensionStatementDto {
  uploadId: string;
  title: string;
  fundName: string | null;
  /** The fund it matches by name, if one. */
  fundId: string | null;
  date: string | null;
  value: number | null;
  paidIn: number | null;
  employee: number | null;
  employer: number | null;
  tfr: number | null;
  investmentLine: string | null;
  memberSince: string | null;
  returnPct: number | null;
  /** Why it cannot be confirmed as it is (no date or no value). */
  missing: string[];
}

export interface PensionOverviewDto {
  funds: PensionFundDto[];
  statements: PensionStatementDto[];
  payments: PensionPaymentDto[];
  /** Newest first. */
  years: PensionYearDto[];
  thisYear: PensionThisYearDto | null;
  pending: PendingPensionStatementDto[];
  documents: PensionDocumentDto[];
  /** Whether any payslip shows a pension fund line. */
  onPayslips: boolean;
  /** Everything paid in on record, and the total value of the funds. */
  totalPaidIn: number;
  totalValue: number | null;
  limit: number;
  sources: readonly { label: string; url: string }[];
}

/** The deduction limit of the year now, for pages that only show it. */
export function currentPensionLimit(today = new Date()): number {
  return pensionDeductionLimit(today.getFullYear());
}
