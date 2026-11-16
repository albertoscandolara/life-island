import {
  PAYSLIP_KEYS,
  TAX_RETURN_CATEGORY,
  TAX_RETURN_FORM_LABELS,
  TAX_RETURN_FORMS,
  TAX_RETURN_KEYS,
  TAX730_FIGURE_LABELS,
  grossIrpef as contractsGrossIrpef,
  pensionDeductionLimit,
  secondAdvanceDeadline,
  taxReturnDeadline,
  type DeadlineDto,
  type Tax730CertificateDto,
  type Tax730ComparisonLineDto,
  type Tax730DeductionGroup,
  type Tax730DeductionsDto,
  type Tax730ExpenseBucketsDto,
  type Tax730FiledReturnDto,
  type Tax730ForecastDto,
  type Tax730ReturnComparisonDto,
  type Tax730TaxFiguresDto,
  type Tax730TaxReturnDto,
  type TaxReturnForm,
} from '@life-island/contracts';
import { amount, type CertificateSource } from './income.js';

/*
 * The return of a year (730 or Redditi PF): read from the return you
 * uploaded, forecast from your other documents until then, and the two
 * compared once both exist. Pure functions, unit-tested on their own.
 */

export const PAYSLIP_CATEGORY = 'PAYSLIP';

const round = (value: number) => Math.round(value * 100) / 100;
const EURO = new Intl.NumberFormat('it-IT', {
  style: 'currency',
  currency: 'EUR',
  useGrouping: 'always',
} as unknown as Intl.NumberFormatOptions);
export const euro = (n: number) => EURO.format(n).replace(/\s/g, ' ');
const DAY = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  timeZone: 'UTC',
});
const day = (iso: string) => DAY.format(new Date(`${iso}T00:00:00Z`));

type Fields = Record<string, string | number | boolean | null>;

function text(value: unknown): string | null {
  if (typeof value === 'number') return String(value);
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed || null;
}

function dateOf(value: unknown): string | null {
  const raw = text(value);
  if (!raw) return null;
  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) return raw.slice(0, 10);
  // As printed: 18/9/2026.
  const it = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(raw);
  return it
    ? `${it[3]}-${it[2].padStart(2, '0')}-${it[1].padStart(2, '0')}`
    : null;
}

/** An amount as the return prints it, always positive (a credit has its own field). */
function money(value: unknown): number | null {
  const n = amount(value);
  return n === null ? null : Math.abs(n);
}

export function formOf(value: unknown): TaxReturnForm | null {
  const raw = text(value)
    ?.toLowerCase()
    .replace(/[^a-z0-9]/g, '');
  if (!raw) return null;
  if (raw.includes('730')) return '730';
  if (/redditi|unico|rpf|pf/.test(raw)) return 'redditi_pf';
  return (TAX_RETURN_FORMS as readonly string[]).includes(raw)
    ? (raw as TaxReturnForm)
    : null;
}

function kindOf(value: unknown): Tax730FiledReturnDto['kind'] {
  const raw = text(value)?.toLowerCase() ?? '';
  if (/correct|corrett/.test(raw)) return 'correction';
  if (/supplement|integrativ/.test(raw)) return 'supplementary';
  return 'ordinary';
}

const sumOf = (values: (number | null)[]): number | null =>
  values.some((v) => v !== null)
    ? round(values.reduce<number>((t, v) => t + (v ?? 0), 0))
    : null;

/** The return as read from one TAX_RETURN document; null without a tax year. */
export function readReturn(
  doc: CertificateSource,
): Tax730FiledReturnDto | null {
  const K = TAX_RETURN_KEYS;
  const f: Fields = doc.fields ?? {};
  const taxYear = Math.round(amount(f[K.taxYear]) ?? 0);
  if (taxYear < 1900 || taxYear > 2100) return null;
  const form = formOf(f[K.form]) ?? 'redditi_pf';

  const totalIncome = money(f[K.totalIncome]);
  const mainHome = money(f[K.mainHomeDeduction]);
  const workDeductions = money(f[K.workDeductions]);
  const totalDeductions = money(f[K.totalDeductions]);
  const buckets: Tax730ExpenseBucketsDto = {
    general: money(f[K.expenseDeductions19]),
    renovation: money(f[K.renovationDeductions]),
    otherHome: money(f[K.otherHomeDeductions]),
    energy: money(f[K.energyDeductions]),
  };
  const expenseDeductions =
    totalDeductions !== null
      ? round(Math.max(0, totalDeductions - (workDeductions ?? 0)))
      : sumOf(Object.values(buckets));
  const netTax = money(f[K.netTax]);
  const withheld = money(f[K.irpefWithheld]);
  const advances = money(f[K.advancesPaid]);
  const irpefDue = money(f[K.irpefDue]) ?? 0;
  const irpefCredit = money(f[K.irpefCredit]) ?? 0;
  const figures: Tax730TaxFiguresDto = {
    income: totalIncome === null ? null : round(totalIncome - (mainHome ?? 0)),
    deductibleExpenses: money(f[K.deductibleExpenses]),
    taxableIncome: money(f[K.taxableIncome]),
    grossTax: money(f[K.grossTax]),
    workDeductions,
    expenseDeductions,
    netTax,
    irpefWithheld: withheld,
    advancesPaid: advances,
    balance:
      netTax !== null && withheld !== null
        ? round(netTax - withheld - (advances ?? 0))
        : irpefDue || irpefCredit
          ? round(irpefDue - irpefCredit)
          : null,
  };
  const surtaxDue = round(
    (money(f[K.regionalDue]) ?? 0) + (money(f[K.municipalDue]) ?? 0),
  );
  const surtaxCredit = round(
    (money(f[K.regionalCredit]) ?? 0) + (money(f[K.municipalCredit]) ?? 0),
  );
  const filed: Tax730FiledReturnDto = {
    uploadId: doc.uploadId,
    title: doc.title,
    form,
    formLabel: TAX_RETURN_FORM_LABELS[form],
    taxYear,
    filedOn: dateOf(f[K.filedOn]),
    filingId: text(f[K.filingId]),
    kind: kindOf(f[K.kind]),
    figures,
    buckets,
    irpefDue,
    irpefCredit,
    surtaxDue,
    surtaxCredit,
    result: round(irpefDue + surtaxDue - irpefCredit - surtaxCredit),
    nextAdvanceFirst: money(f[K.nextAdvanceFirst]) ?? 0,
    nextAdvanceSecond: money(f[K.nextAdvanceSecond]) ?? 0,
    notes: [],
  };
  filed.notes = returnNotes(filed);
  return filed;
}

/** What a filed return leaves you to do. */
function returnNotes(r: Tax730FiledReturnDto): string[] {
  const notes: string[] = [];
  const deadline = taxReturnDeadline(r.taxYear, r.form);
  if (r.filedOn && r.filedOn > deadline)
    notes.push(
      `Filed on ${day(r.filedOn)}, after the ${day(deadline)} deadline: a return sent within 90 days is valid, with a small penalty (ravvedimento operoso).`,
    );
  const credit = round(r.irpefCredit + r.surtaxCredit);
  const due = round(r.irpefDue + r.surtaxDue);
  if (r.form === 'redditi_pf') {
    if (credit > 0)
      notes.push(
        `${euro(credit)} in credit (IRPEF ${euro(r.irpefCredit)}, surtaxes ${euro(r.surtaxCredit)}). With Redditi PF your employer does not pay it back: use it in an F24 to offset other taxes (advances, IMU), or it carries over to next year's return.`,
      );
    if (due > 0)
      notes.push(
        `${euro(due)} to pay with F24 (IRPEF ${euro(r.irpefDue)}, surtaxes ${euro(r.surtaxDue)}), by 30 June of ${r.taxYear + 1} or 30 July with 0.4% more. If the commercialista paid it for you, keep the F24 receipt.`,
      );
    if (r.nextAdvanceFirst + r.nextAdvanceSecond > 0)
      notes.push(
        `Advances for ${r.taxYear + 1}: ${euro(r.nextAdvanceFirst)} by 30 June and ${euro(r.nextAdvanceSecond)} by ${day(secondAdvanceDeadline(r.taxYear + 1))}, with F24.`,
      );
  } else {
    if (credit > 0)
      notes.push(
        `${euro(credit)} in credit: your employer pays it back in the July or August payslip.`,
      );
    if (due > 0)
      notes.push(
        `${euro(due)} to pay: your employer takes it from the July or August payslip.`,
      );
  }
  if (!notes.length) notes.push('Nothing left to pay or to claim.');
  return notes;
}

/**
 * The return of each tax year: of two for the same year the later filing
 * counts (a correction or a supplementary return), then the later upload.
 */
export function returnsOf(
  docs: readonly CertificateSource[],
): Map<number, Tax730FiledReturnDto> {
  const byYear = new Map<
    number,
    { filed: Tax730FiledReturnDto; uploadedAt: number }
  >();
  for (const doc of docs) {
    if (!doc.categories.includes(TAX_RETURN_CATEGORY)) continue;
    const filed = readReturn(doc);
    if (!filed) continue;
    const current = byYear.get(filed.taxYear);
    const later =
      !current ||
      (filed.filedOn ?? '') > (current.filed.filedOn ?? '') ||
      ((filed.filedOn ?? '') === (current.filed.filedOn ?? '') &&
        doc.uploadedAt.getTime() > current.uploadedAt);
    if (later)
      byYear.set(filed.taxYear, {
        filed,
        uploadedAt: doc.uploadedAt.getTime(),
      });
  }
  return new Map([...byYear].map(([year, v]) => [year, v.filed]));
}

// ---------------------------------------------------------------------------
// The forecast
// ---------------------------------------------------------------------------

/** Imposta lorda on a taxable income, with the brackets of the year. */
export const grossIrpef = contractsGrossIrpef;

/**
 * Employment tax credits for a full year (art. 13 TUIR), with the
 * ulteriore detrazione from 2025. Used only without a CU, which prints them.
 */
export function employmentCredits(income: number, taxYear: number): number {
  let credit: number;
  if (income <= 15000) credit = taxYear >= 2024 ? 1955 : 1880;
  else if (income <= 28000) credit = 1910 + (1190 * (28000 - income)) / 13000;
  else if (income <= 50000) credit = (1910 * (50000 - income)) / 22000;
  else credit = 0;
  if (income > 25000 && income <= 35000) credit += 65;
  if (taxYear >= 2025) {
    if (income > 20000 && income <= 32000) credit += 1000;
    else if (income > 32000 && income <= 40000)
      credit += (1000 * (40000 - income)) / 8000;
  }
  return round(credit);
}

/** Where each kind of expense lands in the return's RN rows. */
const BUCKET_OF: Record<Tax730DeductionGroup, keyof Tax730ExpenseBucketsDto> = {
  health: 'general',
  veterinary: 'general',
  education: 'general',
  sport_kids: 'general',
  mortgage_interest: 'general',
  insurance: 'general',
  agency_fees: 'general',
  other: 'general',
  renovation: 'renovation',
  furniture: 'otherHome',
  energy_efficiency: 'energy',
};

export function bucketsOf(
  deductions: Pick<Tax730DeductionsDto, 'lines' | 'carried'>,
): Tax730ExpenseBucketsDto {
  const buckets: Tax730ExpenseBucketsDto = {
    general: 0,
    renovation: 0,
    otherHome: 0,
    energy: 0,
  };
  for (const line of deductions.lines) {
    const key = BUCKET_OF[line.group] ?? 'general';
    buckets[key] = round((buckets[key] ?? 0) + line.deduction);
  }
  for (const c of deductions.carried) {
    const key = BUCKET_OF[c.group] ?? 'general';
    buckets[key] = round((buckets[key] ?? 0) + c.amount);
  }
  return buckets;
}

/** A payslip of the year, as the forecast needs it. */
interface PayslipReading {
  month: string;
  key: string;
  taxable: number | null;
  tax: number | null;
}

/** The payslips of `taxYear`: one per employer, month and kind, the later upload wins. */
export function payslipsOf(
  taxYear: number,
  docs: readonly CertificateSource[],
): PayslipReading[] {
  const byKey = new Map<string, PayslipReading>();
  for (const doc of [...docs].sort(
    (a, b) => a.uploadedAt.getTime() - b.uploadedAt.getTime(),
  )) {
    if (!doc.categories.includes(PAYSLIP_CATEGORY)) continue;
    const f: Fields = doc.fields ?? {};
    const month = text(f[PAYSLIP_KEYS.period])?.slice(0, 7) ?? '';
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) continue;
    if (Number(month.slice(0, 4)) !== taxYear) continue;
    const employer = (text(f['employer_tax_code']) ?? text(f['employer']) ?? '')
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, '');
    const kind = text(f[PAYSLIP_KEYS.kind]) ?? 'regular';
    const key = `${employer}:${month}:${kind}`;
    byKey.set(key, {
      month,
      key,
      taxable: amount(f[PAYSLIP_KEYS.taxable]),
      tax: amount(f[PAYSLIP_KEYS.incomeTax]),
    });
  }
  return [...byKey.values()];
}

export interface ForecastInput {
  taxYear: number;
  /** The year it is now: a year still running is projected to twelve months. */
  currentYear: number;
  certificates: readonly Tax730CertificateDto[];
  payslips: readonly PayslipReading[];
  deductions: Pick<Tax730DeductionsDto, 'lines' | 'carried'>;
  expenseCount: number;
  /** The return of the year before: it sets the advances paid in this one. */
  previousReturn: Tax730FiledReturnDto | null;
}

/** The year's tax from your documents; null when there is nothing to go on. */
export function forecastOf(input: ForecastInput): Tax730ForecastDto | null {
  const { taxYear, certificates, payslips } = input;
  const basis: string[] = [];
  const missing: string[] = [];
  let projected = false;

  let income: number | null = null;
  let withheld: number | null = null;
  let workDeductions: number | null = null;
  if (certificates.length) {
    income = sumOf(certificates.map((c) => c.income));
    withheld = sumOf(certificates.map((c) => c.irpefWithheld));
    if (
      certificates.every(
        (c) => c.workDeductions != null || c.familyDeductions != null,
      )
    )
      workDeductions = sumOf(
        certificates.flatMap((c) => [
          c.workDeductions ?? null,
          c.familyDeductions ?? null,
        ]),
      );
    basis.push(
      certificates.length === 1
        ? `The Certificazione Unica of ${certificates[0].employer ?? 'your employer'}`
        : `${certificates.length} Certificazioni Uniche`,
    );
  } else if (payslips.length) {
    const months = new Set(payslips.map((p) => p.month)).size;
    const taxable = sumOf(payslips.map((p) => p.taxable));
    const tax = sumOf(payslips.map((p) => p.tax));
    const scale = taxYear >= input.currentYear && months < 12 ? 12 / months : 1;
    projected = scale !== 1;
    income = taxable === null ? null : round(taxable * scale);
    withheld = tax === null ? null : round(tax * scale);
    basis.push(
      projected
        ? `Payslips of ${months} ${months === 1 ? 'month' : 'months'}, scaled to the year`
        : `Payslips of ${months} ${months === 1 ? 'month' : 'months'}`,
    );
    missing.push(
      `The Certificazione Unica of ${taxYear} (in March ${taxYear + 1}): it has the exact income, tax withheld and tax credits.`,
    );
    if (!projected && months < 12)
      missing.push(
        `Payslips of ${12 - months} more ${12 - months === 1 ? 'month' : 'months'} of ${taxYear}.`,
      );
  } else {
    missing.push(
      `The Certificazione Unica of ${taxYear}, or your payslips: without them there is no income to forecast.`,
    );
  }

  const buckets = bucketsOf(input.deductions);
  const expenseDeductions = sumOf(Object.values(buckets));
  if (input.expenseCount)
    basis.push(
      `${input.expenseCount} deductible ${input.expenseCount === 1 ? 'expense' : 'expenses'}`,
    );
  if (input.deductions.carried.length)
    basis.push('Home bonus instalments of earlier years');

  // Pension fund contributions the employer did not deduct: the return does.
  const fundDeducted = sumOf(certificates.map((c) => c.pensionFundDeducted));
  const fundNotDeducted = sumOf(
    certificates.map((c) => c.pensionFundNotDeducted),
  );
  const deductible =
    fundNotDeducted === null
      ? 0
      : round(
          Math.min(
            fundNotDeducted,
            Math.max(0, pensionDeductionLimit(taxYear) - (fundDeducted ?? 0)),
          ),
        );

  if (income === null && !input.expenseCount) return null;

  const taxable =
    income === null ? null : round(Math.max(0, income - deductible));
  const gross = taxable === null ? null : grossIrpef(taxable, taxYear);
  if (workDeductions === null && taxable !== null)
    workDeductions = employmentCredits(taxable, taxYear);
  const netTax =
    gross === null
      ? null
      : round(
          Math.max(0, gross - (workDeductions ?? 0) - (expenseDeductions ?? 0)),
        );

  const previous = input.previousReturn;
  const advances = previous
    ? round(previous.nextAdvanceFirst + previous.nextAdvanceSecond)
    : null;
  if (previous && advances)
    basis.push(
      `The advances set by your ${previous.formLabel} for ${previous.taxYear}`,
    );
  else if (!previous && taxYear > 2000)
    missing.push(
      `Your return for ${taxYear - 1}: it says which advances (acconti) you paid in ${taxYear}.`,
    );

  const figures: Tax730TaxFiguresDto = {
    income,
    deductibleExpenses: income === null ? null : deductible,
    taxableIncome: taxable,
    grossTax: gross,
    workDeductions,
    expenseDeductions,
    netTax,
    irpefWithheld: withheld,
    advancesPaid: advances,
    balance:
      netTax !== null && withheld !== null
        ? round(netTax - withheld - (advances ?? 0))
        : null,
  };
  return { figures, buckets, basis, missing, projected };
}

// ---------------------------------------------------------------------------
// The comparison
// ---------------------------------------------------------------------------

/** Returns round to the euro: a few euros or 1% apart is the same figure. */
const tolerance = (value: number) => Math.max(5, Math.abs(value) * 0.01);

const BUCKET_TEXT: Record<
  keyof Tax730ExpenseBucketsDto,
  { name: string; row: string; upload: string }
> = {
  general: {
    name: '19% expenses',
    row: 'RN13',
    upload:
      'health expenses and medicines (the precompilata lists those sent to the Sistema Tessera Sanitaria), insurance, school, sport, mortgage interest, vet',
  },
  renovation: {
    name: 'building bonus instalments',
    row: 'RN14',
    upload:
      'the invoices and bonifici parlanti of the works, also of earlier years still in their ten instalments',
  },
  otherHome: {
    name: 'furniture and other home bonuses',
    row: 'RN15',
    upload:
      'the invoices and card or transfer receipts of furniture and appliances for the renovated home (bonus mobili), also of earlier years',
  },
  energy: {
    name: 'energy efficiency instalments',
    row: 'RN16',
    upload: 'the invoices, bonifici and ENEA receipt of the energy works',
  },
};

export function compareReturn(
  filed: Tax730FiledReturnDto,
  forecast: Tax730ForecastDto,
  context: { hasCertificates: boolean; payslipOnly: boolean },
): Tax730ReturnComparisonDto {
  const keys = Object.keys(
    TAX730_FIGURE_LABELS,
  ) as (keyof Tax730TaxFiguresDto)[];
  const lines: Tax730ComparisonLineDto[] = keys.map((key) => {
    const a = filed.figures[key];
    const b = forecast.figures[key];
    const comparable = a !== null && b !== null;
    return {
      key,
      label: TAX730_FIGURE_LABELS[key].label,
      row: TAX730_FIGURE_LABELS[key].row,
      filed: a,
      forecast: b,
      difference: comparable ? round(a - b) : null,
      matches: comparable ? Math.abs(a - b) <= tolerance(a) : null,
    };
  });
  const line = (key: keyof Tax730TaxFiguresDto) =>
    lines.find((l) => l.key === key) as Tax730ComparisonLineDto;
  const off = (key: keyof Tax730TaxFiguresDto) => line(key).matches === false;
  const gap = (key: keyof Tax730TaxFiguresDto) => line(key).difference ?? 0;
  const year = filed.taxYear;
  const causes: string[] = [];

  // Income.
  if (forecast.figures.income === null && filed.figures.income !== null)
    causes.push(
      `There is no Certificazione Unica or payslip of ${year} in your documents: upload the CU of every employer.`,
    );
  else if (off('income') && gap('income') > 0)
    causes.push(
      `The return has ${euro(gap('income'))} more income than your documents. ` +
        (context.hasCertificates
          ? 'Likely missing: the Certificazione Unica of another employer or of INPS (NASpI, maternity, sick pay), or income from freelance work, rent or other sources (quadri RL, LM, RE, RB of the Redditi PF).'
          : `The forecast reads only your payslips: upload the Certificazione Unica of ${year}, and the CU of any other employer or of INPS.`),
    );
  else if (off('income'))
    causes.push(
      `The return has ${euro(-gap('income'))} less income than your documents: check for a Certificazione Unica uploaded twice, or one of another year.`,
    );

  // Deductible charges.
  if (off('deductibleExpenses') && gap('deductibleExpenses') > 0)
    causes.push(
      `${euro(gap('deductibleExpenses'))} of deductible charges (oneri deducibili, RN3) you have not uploaded: contributions you paid yourself (INPS, a pension fund by transfer), donations, alimony. Upload their receipts.`,
    );
  else if (off('deductibleExpenses'))
    causes.push(
      `Your CU shows ${euro(-gap('deductibleExpenses'))} of pension fund contributions the employer did not deduct, and the return did not deduct them: ask the commercialista.`,
    );

  // Expense credits, section by section.
  const bucketKeys = Object.keys(
    BUCKET_TEXT,
  ) as (keyof Tax730ExpenseBucketsDto)[];
  let bucketCause = false;
  for (const key of bucketKeys) {
    const a = filed.buckets[key];
    const b = forecast.buckets[key] ?? 0;
    if (a === null) continue;
    const diff = round(a - b);
    if (Math.abs(diff) <= tolerance(a)) continue;
    bucketCause = true;
    const t = BUCKET_TEXT[key];
    causes.push(
      diff > 0
        ? `${euro(diff)} more ${t.name} in the return (${t.row}: ${euro(a)}) than in the 730 area (${euro(b)}). Upload ${t.upload}.`
        : `Your ${t.name} in the 730 area (${euro(b)}) are ${euro(-diff)} more than the return's (${t.row}: ${euro(a)}): some expenses may not have reached the commercialista, or they do not qualify (paid in cash, for someone else).`,
    );
  }
  if (!bucketCause && off('expenseDeductions'))
    causes.push(
      gap('expenseDeductions') > 0
        ? `${euro(gap('expenseDeductions'))} more credits from expenses in the return than in the 730 area: upload the invoices and payment proofs of the expenses the commercialista declared.`
        : `${euro(-gap('expenseDeductions'))} of credits from your expenses are not in the return: some expenses may not have reached the commercialista, or they do not qualify.`,
    );

  // Employment credits: only telling when the income agrees.
  if (off('workDeductions') && !off('income'))
    causes.push(
      context.hasCertificates
        ? `The employment and family tax credits differ by ${euro(Math.abs(gap('workDeductions')))}: family members you support, days worked or a productivity bonus change them. Check the CU against the return.`
        : `The employment tax credits are estimated without a Certificazione Unica: upload it for the exact figure.`,
    );

  // Withholding.
  if (off('irpefWithheld'))
    causes.push(
      gap('irpefWithheld') > 0
        ? `The return counts ${euro(gap('irpefWithheld'))} more IRPEF withheld than your documents: a Certificazione Unica${context.payslipOnly ? ' (or some payslips)' : ''} is likely missing.`
        : `Your documents show ${euro(-gap('irpefWithheld'))} more IRPEF withheld than the return: check for a CU uploaded twice.`,
    );

  // Advances.
  if (
    forecast.figures.advancesPaid === null &&
    (filed.figures.advancesPaid ?? 0) > 0
  )
    causes.push(
      `The return counts ${euro(filed.figures.advancesPaid ?? 0)} of advances paid in ${year}: upload your return for ${year - 1}, which set them.`,
    );
  else if (off('advancesPaid'))
    causes.push(
      `The advances paid differ by ${euro(Math.abs(gap('advancesPaid')))} from what your ${year - 1} return asked: you may have paid less or more with F24 (keep the receipts).`,
    );

  // Tax credits bigger than the tax: the excess is lost.
  const gross = filed.figures.grossTax;
  const credits =
    (filed.figures.workDeductions ?? 0) +
    (filed.figures.expenseDeductions ?? 0);
  if (gross !== null && credits > gross && filed.figures.netTax === 0)
    causes.push(
      `Your tax credits (${euro(credits)}) were more than the gross tax (${euro(gross)}): the net tax is zero and ${euro(round(credits - gross))} of credits went unused: tax credits are not carried to a later year, and a building bonus instalment that does not fit is lost too.`,
    );

  const comparable = lines.filter((l) => l.matches !== null);
  const matches = comparable.length > 0 && comparable.every((l) => l.matches);
  const balance = line('balance');
  const summary = !comparable.length
    ? 'Too few figures to compare.'
    : matches
      ? `The return matches the forecast from your documents.`
      : balance.difference !== null && balance.matches === false
        ? `The return differs from the forecast: the IRPEF result is ${euro(Math.abs(balance.difference))} ${balance.difference > 0 ? 'higher' : 'lower'} than your documents predicted.`
        : `The return differs from the forecast on ${comparable.filter((l) => !l.matches).length} of ${comparable.length} figures.`;
  if (!matches && !causes.length)
    causes.push(
      'The gap comes from items the forecast does not model: family tax credits, other tax credits or a credit from the year before.',
    );
  return { matches, summary, lines, causes: matches ? [] : causes };
}

// ---------------------------------------------------------------------------
// The year's return and its deadline
// ---------------------------------------------------------------------------

/**
 * The form you are expected to file for `taxYear`: the one of your latest
 * return before it, the 730 when there is none.
 */
export function expectedForm(
  taxYear: number,
  returns: ReadonlyMap<number, Tax730FiledReturnDto>,
): TaxReturnForm {
  const filed = returns.get(taxYear);
  if (filed) return filed.form;
  const earlier = [...returns.keys()]
    .filter((y) => y < taxYear)
    .sort((a, b) => b - a);
  return earlier.length ? (returns.get(earlier[0])?.form ?? '730') : '730';
}

export function taxReturnOf(input: {
  taxYear: number;
  today: string;
  returns: ReadonlyMap<number, Tax730FiledReturnDto>;
  forecast: Tax730ForecastDto | null;
  hasCertificates: boolean;
  payslipOnly: boolean;
}): Tax730TaxReturnDto {
  const filed = input.returns.get(input.taxYear) ?? null;
  const form = expectedForm(input.taxYear, input.returns);
  const deadline = taxReturnDeadline(input.taxYear, form);
  return {
    form,
    formLabel: TAX_RETURN_FORM_LABELS[form],
    filingYear: input.taxYear + 1,
    deadline,
    status: filed ? 'filed' : input.today > deadline ? 'late' : 'open',
    filed,
    forecast: input.forecast,
    comparison:
      filed && input.forecast
        ? compareReturn(filed, input.forecast, {
            hasCertificates: input.hasCertificates,
            payslipOnly: input.payslipOnly,
          })
        : null,
  };
}

/**
 * The filing deadline of each year in the window, for the Agenda: done once
 * that year's return is uploaded, on the date of the form you file (Redditi
 * PF by 31 October, the 730 by 30 September). After a Redditi PF that asks
 * for a second advance, its 30 November F24 too.
 */
export function deadlinesOf(
  window: { from: string; to: string },
  returns: ReadonlyMap<number, Tax730FiledReturnDto>,
): DeadlineDto[] {
  const deadlines: DeadlineDto[] = [];
  const first = Number(window.from.slice(0, 4));
  const last = Number(window.to.slice(0, 4));
  for (let filingYear = first; filingYear <= last; filingYear++) {
    const taxYear = filingYear - 1;
    const filed = returns.get(taxYear) ?? null;
    const form = expectedForm(taxYear, returns);
    const label = TAX_RETURN_FORM_LABELS[form];
    const date = taxReturnDeadline(taxYear, form);
    if (date >= window.from && date <= window.to)
      deadlines.push({
        id: `return-${taxYear}`,
        module: 'taxes',
        kind: 'tax-return',
        title: `${label} deadline (${taxYear} income)`,
        detail: filed
          ? `Filed${filed.filedOn ? ` on ${day(filed.filedOn)}` : ''}: the ${label} ${filingYear} is in the 730 area.`
          : form === 'redditi_pf'
            ? `Last day to send the Redditi PF for ${taxYear}, as you did last year (usually through the commercialista). Upload it in the documents app once filed.`
            : `Last day to send the 730 for ${taxYear}, on your own or through a CAF or the commercialista. Upload it in the documents app once filed.`,
        date,
        amount: null,
        path: '/taxes/730',
        done: filed !== null,
      });
    const previous = returns.get(filingYear - 1);
    if (previous?.form === 'redditi_pf' && previous.nextAdvanceSecond > 0) {
      const due = secondAdvanceDeadline(filingYear);
      if (due >= window.from && due <= window.to)
        deadlines.push({
          id: `advance-${filingYear}`,
          module: 'taxes',
          kind: 'tax-advance',
          title: `Second IRPEF advance for ${filingYear} (F24)`,
          detail: `Set by your Redditi PF for ${filingYear - 1}: pay it with an F24, or let the commercialista do it.`,
          date: due,
          amount: previous.nextAdvanceSecond,
          path: '/taxes/730',
        });
    }
  }
  return deadlines;
}
