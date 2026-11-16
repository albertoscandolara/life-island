import {
  parseNumber,
  pensionDeductionLimit,
  pensionNoticeDeadline,
  TAX730_HIGH_INCOME_LIMIT,
  TAX730_INCOME_LIMIT,
  TAX_CERTIFICATE_KEYS,
  tax730DeductionRules,
  type Tax730CertificateDto,
  type Tax730DeductionLineDto,
  type Tax730IncomeDto,
  type Tax730PensionFundDto,
} from '@life-island/contracts';

/*
 * The income side of the 730, from the Certificazioni Uniche you uploaded:
 * what you earned, the IRPEF withheld and the net tax, the most the
 * deductions can give back. Pure functions, unit-tested on their own.
 */

/** The category of a Certificazione Unica (migration 0019 of svc-ingestion). */
export const CERTIFICATE_CATEGORY = 'CERTIFICAZIONE_UNICA';

/** What the estimate needs of a document. */
export interface CertificateSource {
  uploadId: string;
  title: string;
  categories: string[];
  fields: Record<string, string | number | boolean | null> | null;
  uploadedAt: Date;
}

const round = (value: number) => Math.round(value * 100) / 100;
// As the page writes amounts: 3.200,00 € (Italian leaves 4 digits ungrouped
// unless 'always', an option missing from the es2022 typings), plain spaces.
const EURO = new Intl.NumberFormat('it-IT', {
  style: 'currency',
  currency: 'EUR',
  useGrouping: 'always',
} as unknown as Intl.NumberFormatOptions);
const euro = (n: number) => EURO.format(n).replace(/\s/g, ' ');

export function amount(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string') return null;
  const n = parseNumber(value);
  return n === null ? null : round(n);
}

function employerKey(fields: Record<string, unknown>): string {
  const code = String(fields[TAX_CERTIFICATE_KEYS.employerTaxCode] ?? '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
  if (code) return code;
  return String(fields[TAX_CERTIFICATE_KEYS.employer] ?? '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, ' ')
    .trim();
}

/**
 * The CUs about the income of `taxYear`, one per employer: of two from the
 * same employer the later upload counts (a corrected CU, or a copy).
 */
export function certificatesOf(
  taxYear: number,
  docs: readonly CertificateSource[],
): Tax730CertificateDto[] {
  const K = TAX_CERTIFICATE_KEYS;
  const byEmployer = new Map<string, CertificateSource>();
  for (const doc of [...docs].sort(
    (a, b) => a.uploadedAt.getTime() - b.uploadedAt.getTime(),
  )) {
    const fields = doc.fields ?? {};
    if (!doc.categories.includes(CERTIFICATE_CATEGORY)) continue;
    if (Math.round(amount(fields[K.incomeYear]) ?? 0) !== taxYear) continue;
    byEmployer.set(employerKey(fields) || doc.uploadId, doc);
  }
  return [...byEmployer.values()].map((doc) => {
    const fields = doc.fields ?? {};
    const employer = fields[K.employer];
    return {
      uploadId: doc.uploadId,
      title: doc.title,
      employer:
        typeof employer === 'string' && employer.trim()
          ? employer.trim()
          : null,
      income: amount(fields[K.employmentIncome]),
      irpefWithheld: amount(fields[K.irpefWithheld]),
      netTax: amount(fields[K.netTax]),
      pensionFundDeducted: amount(fields[K.pensionFundDeducted]),
      pensionFundNotDeducted: amount(fields[K.pensionFundNotDeducted]),
      workDeductions: amount(fields[K.workDeductions]),
      familyDeductions: amount(fields[K.familyDeductions]),
    };
  });
}

const sum = (values: (number | null)[]) =>
  round(values.reduce<number>((total, v) => total + (v ?? 0), 0));

/**
 * Rigo E27 of the 730 from the CUs of the year: what the employers already
 * deducted (punto 412) and what they did not (punto 413), against the limit.
 * Null when no CU prints a pension fund.
 */
export function pensionFundOf(
  taxYear: number,
  certificates: readonly Tax730CertificateDto[],
): Tax730PensionFundDto | null {
  const withFund = certificates.filter(
    (c) => c.pensionFundDeducted !== null || c.pensionFundNotDeducted !== null,
  );
  if (!withFund.length) return null;
  const deducted = sum(withFund.map((c) => c.pensionFundDeducted));
  const notDeducted = sum(withFund.map((c) => c.pensionFundNotDeducted));
  const limit = pensionDeductionLimit(taxYear);
  const over = round(Math.max(0, deducted + notDeducted - limit));
  const notes = [
    `Column 1 of rigo E27 is ${euro(deducted)}, already taken off your income by the employer: nothing more comes back from it, it is there so the 730 checks the limit.`,
  ];
  if (notDeducted > 0)
    notes.push(
      `Column 2 is ${euro(notDeducted)} the employer did not deduct, plus anything you paid the fund yourself: the 730 deducts it up to the ${euro(limit)} limit.`,
    );
  else
    notes.push(
      'Paid the fund yourself (a transfer, not through the payslip)? Add it to column 2: the 730 deducts it up to the limit.',
    );
  if (over > 0)
    notes.push(
      `${euro(over)} is over the ${euro(limit)} limit: tell the fund by ${pensionNoticeDeadline(taxYear)} that you did not deduct it, so it is not taxed again when the fund pays out.`,
    );
  if (withFund.length > 1)
    notes.push(
      'More than one CU prints a pension fund: the limit is one for the whole year, across every employer.',
    );
  return {
    deducted,
    notDeducted,
    limit,
    over,
    noticeDue: pensionNoticeDeadline(taxYear),
    notes,
  };
}

/**
 * Your income and tax of the year against what the deductions give back:
 * never more than the net tax of your CUs (the rest is lost), and the
 * income limits above €75,000 and €120,000, as notes.
 */
export function incomeOf(
  taxYear: number,
  thisYear: number,
  lines: readonly Tax730DeductionLineDto[],
  certificates: Tax730CertificateDto[],
): Tax730IncomeDto | null {
  if (!certificates.length) return null;
  const income = sum(certificates.map((c) => c.income));
  const irpefWithheld = sum(certificates.map((c) => c.irpefWithheld));
  const withNetTax = certificates.filter((c) => c.netTax !== null);
  const netTax = sum(withNetTax.map((c) => c.netTax));
  const capped = withNetTax.length === certificates.length;
  const refund = capped ? round(Math.min(thisYear, netTax)) : thisYear;
  const lost = round(thisYear - refund);
  const band =
    income > TAX730_HIGH_INCOME_LIMIT
      ? 'over_120k'
      : income > TAX730_INCOME_LIMIT
        ? 'over_75k'
        : 'normal';

  const notes: string[] = [];
  if (lost > 0)
    notes.push(
      `Your deductions (${euro(thisYear)}) are more than the tax you owe (${euro(netTax)}): only ${euro(refund)} comes back, the other ${euro(lost)} is lost and not carried to a later year.`,
    );
  if (!capped)
    notes.push(
      'A Certificazione Unica does not show the net tax (punto 375): the tax back is not checked against the tax you owe.',
    );
  if (certificates.length > 1)
    notes.push(
      'With more than one Certificazione Unica the 730 adds the incomes up: the tax on the total can be higher than what each employer withheld.',
    );
  if (band !== 'normal' && taxYear >= 2025) {
    const rules = new Map(
      tax730DeductionRules(taxYear).map((r) => [r.group, r]),
    );
    const cappedSpent = round(
      lines
        .filter((l) => rules.get(l.group)?.incomeCapped)
        .reduce((total, l) => total + l.eligible, 0),
    );
    const base = income > 100000 ? 8000 : 14000;
    notes.push(
      `Your income is above ${euro(TAX730_INCOME_LIMIT)}: expenses other than health count together at most ${euro(base)} times a coefficient for your children (0.5 with none, so ${euro(base / 2)}). Yours this year: ${euro(cappedSpent)}. Not applied in this estimate.`,
    );
  }
  if (band === 'over_120k')
    notes.push(
      `Your income is above ${euro(TAX730_HIGH_INCOME_LIMIT)}: most 19% deductions (not health or mortgage interest) shrink, down to nothing at 240.000 €. Not applied in this estimate.`,
    );
  return {
    certificates,
    income,
    irpefWithheld,
    netTax,
    band,
    refund,
    lost,
    pensionFund: pensionFundOf(taxYear, certificates),
    notes,
  };
}
