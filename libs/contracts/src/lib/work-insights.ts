import { z } from 'zod';

/*
 * Career analysis in Work: the reference tables it reads your pay against
 * (inflation, CCNL minimums, IRPEF brackets), the net pay estimate the offer
 * comparison uses, and what svc-work computes from your payslips and
 * evaluations. Reference tables are public figures copied here with their
 * source; update them when a new year or a CCNL renewal comes out.
 */

// ---------------------------------------------------------------------------
// Inflation: ISTAT FOI (prices for families of blue- and white-collar workers,
// without tobacco), the index used to revalue wages and rents in Italy.

/** Average change of the FOI index over the year before, in percent. */
export const FOI_ANNUAL_CHANGE_PCT: Readonly<Record<number, number>> = {
  2016: -0.1,
  2017: 1.2,
  2018: 1.1,
  2019: 0.4,
  2020: -0.2,
  2021: 1.8,
  2022: 8.0,
  2023: 5.4,
  2024: 0.9,
  2025: 1.4,
  2026: 2.5,
};
/** The last year in FOI_ANNUAL_CHANGE_PCT is an average of these months only. */
export const FOI_PARTIAL_YEAR = { year: 2026, months: 'January to September' };
export const FOI_SOURCE = {
  label: 'ISTAT FOI without tobacco, yearly averages (via rivaluta.it)',
  url: 'https://www.rivaluta.it/istat/tabella-medie-anno-indici-istat-foi.asp',
};

/** The FOI level of a year, 2015 = 100, chained from the yearly changes; null outside the table. */
export function foiIndex(year: number): number | null {
  if (year < 2015) return null;
  let index = 100;
  for (let y = 2016; y <= year; y++) {
    const change = FOI_ANNUAL_CHANGE_PCT[y];
    if (change === undefined) return null;
    index *= 1 + change / 100;
  }
  return Math.round(index * 100) / 100;
}

export const FOI_LAST_YEAR = Math.max(
  ...Object.keys(FOI_ANNUAL_CHANGE_PCT).map(Number),
);

// ---------------------------------------------------------------------------
// CCNL minimum pay tables.

export interface CcnlTable {
  id: string;
  label: string;
  /** Whether a collective agreement as printed on a payslip is this one. */
  matches: (agreement: string) => boolean;
  /** Levels from the lowest to the highest. */
  levels: readonly string[];
  /** Monthly minimum (minimo tabellare) of each level, from the month it applies (YYYY-MM). */
  steps: readonly {
    from: string;
    minimums: Readonly<Record<string, number>>;
  }[];
  source: { label: string; url: string };
  note: string;
}

const METALMECCANICI_LEVELS = [
  'D1',
  'D2',
  'C1',
  'C2',
  'C3',
  'B1',
  'B2',
  'B3',
  'A1',
] as const;

function metalmeccaniciStep(from: string, amounts: number[]) {
  return {
    from,
    minimums: Object.fromEntries(
      METALMECCANICI_LEVELS.map((level, i) => [level, amounts[i]]),
    ),
  };
}

export const CCNL_TABLES: readonly CcnlTable[] = [
  {
    id: 'metalmeccanici-industria',
    label: 'Metalmeccanici industria (Federmeccanica, Assistal)',
    matches: (agreement) =>
      /METALMECC/i.test(agreement) &&
      !/ARTIGIAN|CONFAPI|UNIONMECCANICA|PMI|COOPERAT/i.test(agreement),
    levels: METALMECCANICI_LEVELS,
    steps: [
      metalmeccaniciStep(
        '2021-06',
        [
          1488.89, 1651.07, 1686.74, 1722.41, 1844.64, 1977.19, 2121.2, 2368.12,
          2424.86,
        ],
      ),
      metalmeccaniciStep(
        '2022-06',
        [
          1509.07, 1673.45, 1709.6, 1745.75, 1869.64, 2003.99, 2149.95, 2400.22,
          2457.72,
        ],
      ),
      metalmeccaniciStep(
        '2023-06',
        [
          1608.67, 1783.9, 1822.43, 1860.97, 1993.04, 2136.25, 2291.85, 2558.63,
          2619.93,
        ],
      ),
      metalmeccaniciStep(
        '2024-06',
        [
          1719.67, 1906.99, 1948.18, 1989.38, 2130.56, 2283.65, 2449.99,
          2735.18, 2800.71,
        ],
      ),
      metalmeccaniciStep(
        '2025-06',
        [
          1742.03, 1931.78, 1973.51, 2015.24, 2158.26, 2313.34, 2481.84,
          2770.74, 2837.12,
        ],
      ),
      metalmeccaniciStep(
        '2026-06',
        [
          1784.94, 1979.37, 2022.12, 2064.88, 2211.43, 2370.33, 2542.98,
          2838.99, 2907.01,
        ],
      ),
      metalmeccaniciStep(
        '2027-06',
        [
          1833.02, 2032.7, 2076.59, 2120.52, 2271.01, 2434.19, 2611.49, 2915.48,
          2985.33,
        ],
      ),
      metalmeccaniciStep(
        '2028-06',
        [
          1885.37, 2090.76, 2135.89, 2181.09, 2335.88, 2503.72, 2686.08,
          2998.76, 3070.61,
        ],
      ),
    ],
    source: {
      label: 'CCNL Metalmeccanici industria 2021-2024 and 2025-2028 tables',
      url: 'https://www.ccnlmetalmeccanici.it/tabelle-retributive/',
    },
    note: 'The 2027 and 2028 minimums are a floor: each June they rise further if inflation turns out higher.',
  },
];

/** The table of a collective agreement as printed, if Life Island has it. */
export function ccnlTableFor(agreement: string | null): CcnlTable | null {
  if (!agreement) return null;
  return CCNL_TABLES.find((table) => table.matches(agreement)) ?? null;
}

/** The minimum of a level in a month (YYYY-MM): the latest step from on or before it. */
export function ccnlMinimum(
  table: CcnlTable,
  level: string,
  period: string,
): number | null {
  const step = [...table.steps]
    .reverse()
    .find((candidate) => candidate.from <= period);
  return step?.minimums[level] ?? null;
}

/** The level above, or null at the top or for a level not in the table. */
export function nextCcnlLevel(table: CcnlTable, level: string): string | null {
  const at = table.levels.indexOf(level);
  return at < 0 || at === table.levels.length - 1 ? null : table.levels[at + 1];
}

// ---------------------------------------------------------------------------
// IRPEF and the net pay estimate.

export interface TaxBracket {
  /** The top of the bracket; null for the last. */
  upTo: number | null;
  ratePct: number;
}

/** The national IRPEF brackets, from the year they apply. */
export const IRPEF_BRACKETS: readonly {
  from: number;
  brackets: readonly TaxBracket[];
}[] = [
  {
    from: 2022,
    brackets: [
      { upTo: 15000, ratePct: 23 },
      { upTo: 28000, ratePct: 25 },
      { upTo: 50000, ratePct: 35 },
      { upTo: null, ratePct: 43 },
    ],
  },
  {
    from: 2024,
    brackets: [
      { upTo: 28000, ratePct: 23 },
      { upTo: 50000, ratePct: 35 },
      { upTo: null, ratePct: 43 },
    ],
  },
  {
    from: 2026,
    brackets: [
      { upTo: 28000, ratePct: 23 },
      { upTo: 50000, ratePct: 33 },
      { upTo: null, ratePct: 43 },
    ],
  },
];
export const IRPEF_SOURCE = {
  label: 'TUIR art. 11, as changed by the 2024 reform and Legge 199/2025',
  url: 'https://www.ecnews.it/lavoro/news-del-giorno/legge-bilancio-2026-revisione-aliquote-irpef/',
};

export function irpefBrackets(year: number): readonly TaxBracket[] {
  const set =
    [...IRPEF_BRACKETS].reverse().find((b) => b.from <= year) ??
    IRPEF_BRACKETS[0];
  return set.brackets;
}

/** Gross IRPEF on a yearly taxable income, before any deduction. */
export function grossIrpef(taxable: number, year: number): number {
  let tax = 0;
  let floor = 0;
  for (const bracket of irpefBrackets(year)) {
    const top = bracket.upTo ?? Infinity;
    if (taxable > floor)
      tax += ((Math.min(taxable, top) - floor) * bracket.ratePct) / 100;
    floor = top;
  }
  return round2(tax);
}

/** The bracket a yearly taxable income falls in, and how far its top is. */
export function marginalBracket(
  taxable: number,
  year: number,
): { ratePct: number; upTo: number | null; toNext: number | null } {
  for (const bracket of irpefBrackets(year))
    if (bracket.upTo === null || taxable <= bracket.upTo)
      return {
        ratePct: bracket.ratePct,
        upTo: bracket.upTo,
        toNext: bracket.upTo === null ? null : round2(bracket.upTo - taxable),
      };
  return { ratePct: 43, upTo: null, toNext: null };
}

/** Detrazione per lavoro dipendente (TUIR art. 13), for a full year of work. */
export function employeeDeduction(income: number): number {
  let deduction: number;
  if (income <= 15000) deduction = 1955;
  else if (income <= 28000)
    deduction = 1910 + (1190 * (28000 - income)) / 13000;
  else if (income <= 50000) deduction = (1910 * (50000 - income)) / 22000;
  else deduction = 0;
  if (income > 25000 && income <= 35000) deduction += 65;
  return round2(deduction);
}

/**
 * The tax wedge cut in force since 2025 (Legge 207/2024): a tax-free sum on
 * incomes up to 20,000 and an extra deduction from 20,000 to 40,000.
 */
export function wedgeCut(income: number): {
  taxFreeSum: number;
  extraDeduction: number;
} {
  let pct = 0;
  if (income <= 8500) pct = 7.1;
  else if (income <= 15000) pct = 5.3;
  else if (income <= 20000) pct = 4.8;
  const extra =
    income > 20000 && income <= 32000
      ? 1000
      : income > 32000 && income <= 40000
        ? (1000 * (40000 - income)) / 8000
        : 0;
  return {
    taxFreeSum: round2((income * pct) / 100),
    extraDeduction: round2(extra),
  };
}

export interface NetEstimateInput {
  /** Yearly gross salary (RAL). */
  ral: number;
  /** Employee social security contributions over gross, in percent (about 9.19 to 9.49). */
  contributionRatePct: number;
  /** Regional and municipal IRPEF surtaxes together over taxable income, in percent. */
  surtaxRatePct: number;
  year: number;
}

export interface NetEstimate {
  ral: number;
  contributions: number;
  taxable: number;
  grossTax: number;
  deductions: number;
  netTax: number;
  surtaxes: number;
  taxFreeSum: number;
  net: number;
  /** Taxes and contributions over the RAL, in percent. */
  wedgePct: number;
}

/**
 * Yearly net pay of a salary, estimated with the national rules for an
 * employee with a full year of work and no family deductions. Payslips differ
 * by a few euros a month (rounding, timing of surtaxes, other credits).
 */
export function estimateNet(input: NetEstimateInput): NetEstimate {
  const ral = Math.max(0, input.ral);
  const contributions = round2((ral * input.contributionRatePct) / 100);
  const taxable = round2(ral - contributions);
  const grossTax = grossIrpef(taxable, input.year);
  const wedge = wedgeCut(taxable);
  const deductions = round2(
    Math.min(grossTax, employeeDeduction(taxable) + wedge.extraDeduction),
  );
  const netTax = round2(grossTax - deductions);
  const surtaxes = round2((taxable * input.surtaxRatePct) / 100);
  const net = round2(
    ral - contributions - netTax - surtaxes + wedge.taxFreeSum,
  );
  return {
    ral: round2(ral),
    contributions,
    taxable,
    grossTax,
    deductions,
    netTax,
    surtaxes,
    taxFreeSum: wedge.taxFreeSum,
    net,
    wedgePct: ral > 0 ? round1(((ral - net) / ral) * 100) : 0,
  };
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// ---------------------------------------------------------------------------
// What svc-work computes.

/** Your pay of one year against inflation. */
export interface RealPayYearDto {
  year: number;
  /** Average monthly salary on the year's monthly payslips. */
  averageSalary: number | null;
  /** The FOI level of the year (2015 = 100). */
  foi: number | null;
  /** Prices over the year before, in percent. */
  inflationPct: number | null;
  /** The average salary in euros of the latest year on record. */
  realSalary: number | null;
  /** Salary over the year before: as paid, and after inflation, in percent. */
  nominalChangePct: number | null;
  realChangePct: number | null;
}

export interface RealPayDto {
  /** The year whose euros real salaries are in. */
  baseYear: number | null;
  years: RealPayYearDto[];
  /** First year on record to the latest. */
  nominalGrowthPct: number | null;
  inflationPct: number | null;
  realGrowthPct: number | null;
  /** Set when the latest FOI year is an average of part of the year. */
  partialNote: string | null;
  source: { label: string; url: string };
}

/** What a monthly salary is made of. */
export interface SalaryPartsPointDto {
  period: string;
  /** CCNL minimum of your level (minimo tabellare). */
  base: number | null;
  superminimum: number | null;
  /** The rest: seniority increments, contingenza, other personal items. */
  other: number | null;
  total: number | null;
  increments: number | null;
}

export interface CcnlComparisonDto {
  agreement: string | null;
  /** Null when Life Island has no table for the agreement. */
  table: {
    id: string;
    label: string;
    source: { label: string; url: string };
    note: string;
  } | null;
  level: string | null;
  /** This month's minimum for your level, and your salary. */
  minimum: number | null;
  salary: number | null;
  /** How far your salary is above the minimum. */
  aboveMinimum: number | null;
  aboveMinimumPct: number | null;
  nextLevel: string | null;
  nextLevelMinimum: number | null;
  /** Your salary against the next level's minimum (negative: below it). */
  toNextLevel: number | null;
  /** Your level and the next one, step by step, from the latest known to the last agreed. */
  schedule: {
    from: string;
    minimum: number | null;
    nextMinimum: number | null;
  }[];
  /** Each monthly payslip: your salary and the minimum of your level then. */
  history: {
    period: string;
    level: string | null;
    salary: number | null;
    minimum: number | null;
  }[];
}

/** Everything a year paid you, not only the monthly salary. */
export interface PackageYearDto {
  year: number;
  payslips: number;
  /** Gross on every payslip, extra months included. */
  gross: number;
  extraPay: number;
  welfare: number;
  /** Severance (TFR) set aside. */
  severance: number;
  /** Bonus paid by the year's evaluations. */
  bonus: number;
  /** Gross, welfare and severance (bonus is usually already in the gross). */
  total: number;
}

export interface TaxMonthDto {
  period: string;
  gross: number | null;
  contributions: number | null;
  incomeTax: number | null;
  net: number | null;
  /** Gross less contributions, tax and net: surtaxes, other deductions, or credits (negative). */
  other: number | null;
}

export interface IncomeTaxYearDto {
  year: number;
  payslips: number;
  taxable: number;
  incomeTax: number;
  contributions: number;
  gross: number;
  /** IRPEF withheld over taxable income, in percent. */
  effectiveRatePct: number | null;
  contributionRatePct: number | null;
  /** Taxable income of the year, extended to 12 months when some are missing. */
  yearTaxable: number | null;
  marginalRatePct: number | null;
  /** Euros of taxable income before the next bracket. */
  toNextBracket: number | null;
}

export interface TimeOffPointDto {
  period: string;
  vacation: number | null;
  leave: number | null;
}

export interface TimeOffDto {
  points: TimeOffPointDto[];
  /** Change of each balance over the last 12 months, in hours. */
  vacationChange12: number | null;
  leaveChange12: number | null;
  /** Hours of each still to take at the latest payslip. */
  vacationLeft: number | null;
  leaveLeft: number | null;
}

export interface WorkloadPointDto {
  period: string;
  hoursWorked: number | null;
  overtimeHours: number | null;
  overtimePay: number | null;
  travelDays: number | null;
  travelAllowance: number | null;
}

/** An evaluation set against the pay that followed it. */
export interface ReviewPayDto {
  uploadId: string;
  date: string;
  cycle: string | null;
  score: number | null;
  maxScore: number | null;
  payoutPct: number | null;
  bonus: number | null;
  /** Monthly salary at the evaluation and 12 months later (or the latest, if sooner). */
  salaryAt: number | null;
  salaryAfter: number | null;
  afterPeriod: string | null;
  riseAfterPct: number | null;
}

/** Your current job, for the offer comparison. */
export interface OfferBaselineDto {
  employer: string | null;
  monthlySalary: number | null;
  /** Monthly payments a year: 13, or 14 with a quattordicesima. */
  monthsPaid: number;
  ral: number | null;
  contributionRatePct: number;
  surtaxRatePct: number;
  /** Where the surtax rate comes from. */
  surtaxSource: 'certificate' | 'default';
  /** Welfare credits and bonus over the last 12 months. */
  welfare12: number;
  bonus12: number;
  /** Net actually paid over the last 12 months of payslips. */
  net12: number | null;
}

export interface CareerInsightsDto {
  realPay: RealPayDto;
  salaryParts: SalaryPartsPointDto[];
  ccnl: CcnlComparisonDto;
  packages: PackageYearDto[];
  taxMonths: TaxMonthDto[];
  taxYears: IncomeTaxYearDto[];
  timeOff: TimeOffDto;
  workload: WorkloadPointDto[];
  reviewsVsPay: ReviewPayDto[];
  offer: OfferBaselineDto;
}

// ---------------------------------------------------------------------------
// Goals tracker.

export const GOAL_STATUSES = [
  'open',
  'met',
  'partly',
  'missed',
  'dropped',
] as const;
export type GoalStatus = (typeof GOAL_STATUSES)[number];
export const GOAL_STATUS_LABELS: Record<GoalStatus, string> = {
  open: 'Open',
  met: 'Met',
  partly: 'Partly met',
  missed: 'Missed',
  dropped: 'Dropped',
};

/** One goal set by an evaluation. */
export interface GoalDto {
  uploadId: string;
  /** Stable within the evaluation: its text, normalized. */
  key: string;
  text: string;
  /** The evaluation that set it. */
  date: string | null;
  cycle: string | null;
  workplaceName: string | null;
  status: GoalStatus;
  note: string | null;
  updatedAt: string | null;
}

export const goalStatusRequestSchema = z.object({
  uploadId: z.string().uuid(),
  key: z.string().trim().min(1).max(200),
  status: z.enum(GOAL_STATUSES),
  note: z.string().trim().max(1000).nullable().optional(),
});
export type GoalStatusRequest = z.infer<typeof goalStatusRequestSchema>;

/** A goal's key: lower case, letters and digits only, at most 200 characters. */
export function goalKey(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .slice(0, 200);
}

// ---------------------------------------------------------------------------
// Market check: public salary ranges for your role, found on the web by Claude.

export const MARKET_POSITIONS = [
  'below',
  'within',
  'above',
  'unknown',
] as const;
export type MarketPosition = (typeof MARKET_POSITIONS)[number];

export const marketCheckOutputSchema = z.object({
  role: z.string().describe('The role the ranges are for, in a few words'),
  region: z.string().describe('The area the ranges are for'),
  summary: z
    .string()
    .describe(
      'Two or three sentences on where the person stands against the market',
    ),
  ranges: z
    .array(
      z.object({
        source: z.string().describe('The site or survey, by name'),
        url: z.string().describe('The page the figures come from'),
        description: z
          .string()
          .describe('What the figures cover: role, seniority, area, year'),
        low: z
          .number()
          .nullable()
          .describe('Yearly gross (RAL) in euros, low end'),
        median: z
          .number()
          .nullable()
          .describe('Yearly gross (RAL) in euros, median or typical'),
        high: z
          .number()
          .nullable()
          .describe('Yearly gross (RAL) in euros, high end'),
      }),
    )
    .describe('One entry per source found; never invent figures'),
  position: z.enum(MARKET_POSITIONS),
  advice: z.array(z.string()).describe('Two to four concrete next steps'),
});
export type MarketCheckOutput = z.infer<typeof marketCheckOutputSchema>;

export interface MarketCheckDto extends MarketCheckOutput {
  id: string;
  /** Your RAL when the check ran, to set the ranges against. */
  ral: number | null;
  model: string | null;
  createdAt: string;
}

export const marketCheckRequestSchema = z.object({
  role: z.string().trim().max(200).nullable().optional(),
  region: z.string().trim().max(200).nullable().optional(),
});
export type MarketCheckRequest = z.infer<typeof marketCheckRequestSchema>;

// ---------------------------------------------------------------------------
// Negotiation brief.

/** The question the career feedback answers to write a negotiation brief's talking points. */
export const NEGOTIATION_QUESTION =
  'Prepare me for a salary negotiation at my next review: from my data, give me the arguments for a rise or a promotion (strengths), the weak points my manager may raise and how to answer them (watchouts), and what to ask for, with figures (suggestions).';

export interface BriefFactDto {
  label: string;
  value: string;
  detail: string | null;
}

/** One page to bring to a review: the facts of your pay, your reviews and the market. */
export interface NegotiationBriefDto {
  employer: string | null;
  role: string | null;
  level: string | null;
  facts: BriefFactDto[];
  /** Arguments the data supports, in plain sentences. */
  arguments: string[];
  /** What to ask for, with figures where the data gives them. */
  asks: string[];
}
