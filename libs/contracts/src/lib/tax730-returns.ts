/*
 * The tax return of a year (dichiarazione dei redditi), as the 730 area reads
 * it: a Modello 730 or a Modello Redditi Persone Fisiche (Redditi PF, once
 * Unico), uploaded as a document of type TAX_RETURN. Once a year's return is
 * uploaded its figures are certain and the filing deadline is done; until
 * then the 730 area forecasts them from your other documents.
 */

/** The document type of a filed return (migration 0029 of svc-ingestion). */
export const TAX_RETURN_CATEGORY = 'TAX_RETURN';

/** The two forms an employee files with. */
export const TAX_RETURN_FORMS = ['730', 'redditi_pf'] as const;
export type TaxReturnForm = (typeof TAX_RETURN_FORMS)[number];

export const TAX_RETURN_FORM_LABELS: Record<TaxReturnForm, string> = {
  '730': '730',
  redditi_pf: 'Redditi PF',
};

/** The template fields of a TAX_RETURN document. */
export const TAX_RETURN_KEYS = {
  form: 'form_type',
  /** The year the income is about (periodo d'imposta), not the form's year. */
  taxYear: 'tax_year',
  filedOn: 'filed_on',
  filingId: 'filing_id',
  /** ordinary, correction (correttiva) or supplementary (integrativa). */
  kind: 'return_kind',
  employmentIncome: 'employment_income',
  /** RN1, the REDDITO COMPLESSIVO column / 730-3 reddito complessivo. */
  totalIncome: 'total_income',
  /** RN2: the main home's rendita, taken off again. */
  mainHomeDeduction: 'main_home_deduction',
  /** RN3: oneri deducibili. */
  deductibleExpenses: 'deductible_expenses',
  /** RN4. */
  taxableIncome: 'taxable_income',
  /** RN5. */
  grossTax: 'gross_tax',
  /** RN8: employment, pension and family tax credits. */
  workDeductions: 'work_family_deductions',
  /** RN13: 19% (and 26%…) expenses of quadro RP section I. */
  expenseDeductions19: 'expense_deductions_19',
  /** RN14: building bonuses, quadro RP section III-A. */
  renovationDeductions: 'renovation_deductions',
  /** RN15: furniture and the other 50% expenses, quadro RP section III-C. */
  otherHomeDeductions: 'other_home_deductions',
  /** RN16: energy efficiency, quadro RP section IV. */
  energyDeductions: 'energy_deductions',
  /** RN22. */
  totalDeductions: 'total_deductions',
  /** RN26. */
  netTax: 'net_tax',
  /** RN33 col. 4. */
  irpefWithheld: 'irpef_withheld',
  /** RN38 col. 6: acconti paid during the year. */
  advancesPaid: 'advances_paid',
  /** RX1 col. 1 and 2. */
  irpefDue: 'irpef_due',
  irpefCredit: 'irpef_credit',
  /** RX2 col. 1 and 2. */
  regionalDue: 'regional_surtax_due',
  regionalCredit: 'regional_surtax_credit',
  /** RX3 col. 1 and 2. */
  municipalDue: 'municipal_surtax_due',
  municipalCredit: 'municipal_surtax_credit',
  /** RN62: the IRPEF advances for the next year. */
  nextAdvanceFirst: 'next_advance_first',
  nextAdvanceSecond: 'next_advance_second',
  /** RP1 col. 2 / E1: health expenses. */
  healthExpenses: 'health_expenses',
} as const;

/**
 * The last day to file the return about `taxYear`'s income, in the next
 * year: the 730 by 30 September (23 July until 2019), Redditi PF by
 * 31 October (30 November until the returns filed in 2023). A day on a
 * weekend or a public holiday moves to the next working day.
 */
export function taxReturnDeadline(
  taxYear: number,
  form: TaxReturnForm,
): string {
  const year = taxYear + 1;
  const [month, day] =
    form === 'redditi_pf'
      ? year <= 2023
        ? [11, 30]
        : [10, 31]
      : year <= 2019
        ? [7, 23]
        : [9, 30];
  return nextWorkingDay(year, month, day);
}

/** Fixed Italian public holidays, as MM-DD. */
const HOLIDAYS = new Set([
  '01-01',
  '01-06',
  '04-25',
  '05-01',
  '06-02',
  '08-15',
  '11-01',
  '12-08',
  '12-25',
  '12-26',
]);

/** A tax deadline on a weekend or a public holiday moves to the next working day. */
function nextWorkingDay(year: number, month: number, day: number): string {
  const date = new Date(Date.UTC(year, month - 1, day));
  for (;;) {
    const iso = date.toISOString().slice(0, 10);
    const weekday = date.getUTCDay();
    if (weekday !== 0 && weekday !== 6 && !HOLIDAYS.has(iso.slice(5)))
      return iso;
    date.setUTCDate(date.getUTCDate() + 1);
  }
}

/** The second IRPEF advance (secondo acconto) of the year after a Redditi PF: 30 November. */
export function secondAdvanceDeadline(filingYear: number): string {
  return nextWorkingDay(filingYear, 11, 30);
}

/**
 * The tax of a year, as a return prints it or as the forecast expects it.
 * Null where it is not known.
 */
export interface Tax730TaxFiguresDto {
  /** Income that is taxed, before deductible charges (RN1 − RN2). */
  income: number | null;
  /** Oneri deducibili (RN3). */
  deductibleExpenses: number | null;
  /** Reddito imponibile (RN4). */
  taxableIncome: number | null;
  /** Imposta lorda (RN5). */
  grossTax: number | null;
  /** Employment and family tax credits (RN8). */
  workDeductions: number | null;
  /** Tax credits from your expenses (RN13 to RN21, RN22 − RN8). */
  expenseDeductions: number | null;
  /** Imposta netta (RN26). */
  netTax: number | null;
  /** IRPEF your employers withheld (RN33). */
  irpefWithheld: number | null;
  /** Advances paid in the year with F24 (RN38). */
  advancesPaid: number | null;
  /** Net tax less withheld and advances: above zero you pay, below it is a credit. */
  balance: number | null;
}

/** The expense credits of a return by section, to tell which expenses are missing. */
export interface Tax730ExpenseBucketsDto {
  /** 19% expenses: health, insurance, school, sport, mortgage interest (RN13). */
  general: number | null;
  /** Building bonuses (RN14). */
  renovation: number | null;
  /** Furniture and the other home bonuses (RN15). */
  otherHome: number | null;
  /** Energy efficiency (RN16). */
  energy: number | null;
}

/** A return you uploaded: what was filed and what is left to do. */
export interface Tax730FiledReturnDto {
  uploadId: string;
  title: string;
  form: TaxReturnForm;
  formLabel: string;
  taxYear: number;
  filedOn: string | null;
  filingId: string | null;
  kind: 'ordinary' | 'correction' | 'supplementary';
  figures: Tax730TaxFiguresDto;
  buckets: Tax730ExpenseBucketsDto;
  /** The result: IRPEF and the regional and municipal surtaxes, due and in credit. */
  irpefDue: number;
  irpefCredit: number;
  surtaxDue: number;
  surtaxCredit: number;
  /** Everything due less every credit: above zero you pay, below it is yours. */
  result: number;
  /** Advances for the next year (RN62). */
  nextAdvanceFirst: number;
  nextAdvanceSecond: number;
  /** What the result means for you, and what is still to do. */
  notes: string[];
}

/** The year's tax as your documents predict it, before a return is filed. */
export interface Tax730ForecastDto {
  figures: Tax730TaxFiguresDto;
  buckets: Tax730ExpenseBucketsDto;
  /** What it is built from, e.g. "2 Certificazioni Uniche". */
  basis: string[];
  /** Documents that would make it more accurate. */
  missing: string[];
  /** Payslips of part of the year, scaled to twelve months. */
  projected: boolean;
}

export const TAX730_FIGURE_LABELS: Record<
  keyof Tax730TaxFiguresDto,
  { label: string; row: string }
> = {
  income: { label: 'Income', row: 'RN1 − RN2' },
  deductibleExpenses: { label: 'Deductible charges', row: 'RN3' },
  taxableIncome: { label: 'Taxable income', row: 'RN4' },
  grossTax: { label: 'Gross IRPEF', row: 'RN5' },
  workDeductions: { label: 'Employment tax credits', row: 'RN8' },
  expenseDeductions: { label: 'Credits from expenses', row: 'RN13–RN21' },
  netTax: { label: 'Net IRPEF', row: 'RN26' },
  irpefWithheld: { label: 'Withheld by employers', row: 'RN33' },
  advancesPaid: { label: 'Advances paid', row: 'RN38' },
  balance: { label: 'IRPEF to pay (or credit)', row: 'RN34 − RN38' },
};

/** One figure of the filed return against the forecast. */
export interface Tax730ComparisonLineDto {
  key: keyof Tax730TaxFiguresDto;
  label: string;
  row: string;
  filed: number | null;
  forecast: number | null;
  /** Filed minus forecast; null when either is unknown. */
  difference: number | null;
  /** Within a few euros (returns round to the euro); null when not comparable. */
  matches: boolean | null;
}

/** The filed return against what your documents forecast. */
export interface Tax730ReturnComparisonDto {
  matches: boolean;
  summary: string;
  lines: Tax730ComparisonLineDto[];
  /** Why they differ: most likely the documents you did not upload. */
  causes: string[];
}

/** The return of a tax year: filed, or still to file with a forecast. */
export interface Tax730TaxReturnDto {
  /** The filed form, or the one expected (the form of your last return). */
  form: TaxReturnForm;
  formLabel: string;
  filingYear: number;
  deadline: string;
  /** filed; open (deadline ahead); late (deadline passed with no return uploaded). */
  status: 'filed' | 'open' | 'late';
  filed: Tax730FiledReturnDto | null;
  /** From the CUs, payslips and expenses of the year; null with none of them. */
  forecast: Tax730ForecastDto | null;
  /** Only once filed and forecast both exist. */
  comparison: Tax730ReturnComparisonDto | null;
}
