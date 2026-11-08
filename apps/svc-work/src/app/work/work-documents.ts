import {
  CONTRACT_KINDS,
  PAYSLIP_KEYS,
  WORK_DOCUMENT_ROOT,
  WORK_DOCUMENT_TYPES,
  WORKPLACE_FIELD_DEFINITIONS,
  WORKPLACE_FIELDS,
  type WorkDocumentType,
  type WorkFactDto,
  type WorkplaceChangeDto,
  type WorkplaceChangeSuggestion,
  type WorkplaceField,
  type WorkplaceMatch,
  type WorkplaceValue,
  type WorkplaceValues,
} from '@life-island/contracts';

/*
 * Pure rules of the Work area: which documents are work documents, what they
 * print, which workplace they are about and what would change on it. No
 * database here, so every rule is unit-tested on its own.
 */

export type Fields = Record<string, string | number | boolean | null>;
export type ParentOf = ReadonlyMap<string, string | null>;
export type PrintedValues = Partial<Record<WorkplaceField, string | number>>;
export type StoredValues = Partial<Record<WorkplaceField, WorkplaceValue>>;

type Definition = (typeof WORKPLACE_FIELD_DEFINITIONS)[number];
const DEFINITION = new Map<WorkplaceField, Definition>(
  WORKPLACE_FIELD_DEFINITIONS.map((d) => [d.field, d]),
);

export function definitionOf(field: WorkplaceField): Definition | undefined {
  return DEFINITION.get(field);
}

/** A category and everything above it. */
export function withAncestors(id: string, parentOf: ParentOf): string[] {
  const chain: string[] = [];
  let current: string | null | undefined = id;
  while (current && !chain.includes(current)) {
    chain.push(current);
    current = parentOf.get(current);
  }
  return chain;
}

/**
 * Whether a document is a work document and of which type: one of its
 * categories is, or sits under, one of WORK_DOCUMENT_TYPES, or the WORK
 * subject (then the type is unknown).
 */
export function workDocumentType(
  categories: readonly string[],
  parentOf: ParentOf,
): { isWork: boolean; type: WorkDocumentType | null } {
  let isWork = false;
  for (const id of categories) {
    const chain = withAncestors(id, parentOf);
    const type = chain.find((c): c is WorkDocumentType =>
      (WORK_DOCUMENT_TYPES as readonly string[]).includes(c),
    );
    if (type) return { isWork: true, type };
    if (chain.includes(WORK_DOCUMENT_ROOT)) isWork = true;
  }
  return { isWork, type: null };
}

function text(value: string | number | boolean | null | undefined) {
  if (value === null || value === undefined) return null;
  const trimmed = String(value).trim().replace(/\s+/g, ' ');
  return trimmed === '' ? null : trimmed;
}

function dateOf(value: string | number | boolean | null | undefined) {
  const raw = text(value);
  return raw && /^\d{4}-\d{2}-\d{2}/.test(raw) ? raw.slice(0, 10) : null;
}

/** A number as printed: 1242, "1.242,50", "2378.20" or "5,2" (Italian decimals). */
export function numberOf(
  value: string | number | boolean | null | undefined,
): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const raw = text(value);
  if (!raw) return null;
  let cleaned = raw.replace(/[^\d.,-]/g, '');
  if (cleaned.includes(','))
    cleaned = cleaned.replace(/\./g, '').replace(',', '.');
  else if (/^-?\d{1,3}(\.\d{3})+$/.test(cleaned))
    cleaned = cleaned.replace(/\./g, '');
  const n = Number(cleaned);
  return cleaned !== '' && Number.isFinite(n) ? n : null;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** The month a pay period starts in: "2026-06-01/2026-06-30" or "2026-06" as 2026-06. */
export function monthOf(
  value: string | number | boolean | null | undefined,
): string | null {
  const raw = text(value);
  return raw && /^\d{4}-(0[1-9]|1[0-2])/.test(raw) ? raw.slice(0, 7) : null;
}

/** A tax code as compared: digits and letters only, upper-case, without the IT of a VAT number. */
export function normalizeTaxCode(value: string | null): string | null {
  if (!value) return null;
  const code = value
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .replace(/^IT(?=\d{11}$)/, '');
  return code === '' ? null : code;
}

const LEGAL_FORMS =
  /\b(S\.?\s?R\.?\s?L\.?S?|S\.?\s?P\.?\s?A\.?|S\.?\s?N\.?\s?C\.?|S\.?\s?A\.?\s?S\.?|S\.?\s?C\.?\s?A\.?\s?R\.?\s?L\.?|S\.?\s?C\.?\s?R\.?\s?L\.?|SOCIETA'?|COOPERATIVA|UNIPERSONALE|LTD|LLC|INC|GMBH|SA|AG)\b\.?/g;

/** A company name as compared: upper-case, without legal form or punctuation ("Esempio Lavori S.r.l." is ESEMPIO LAVORI). */
export function normalizeName(value: string | null): string | null {
  if (!value) return null;
  const name = value
    .toUpperCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(LEGAL_FORMS, ' ')
    .replace(/[^A-Z0-9]+/g, ' ')
    .trim();
  return name === '' ? null : name;
}

/** How a value is compared: text ignores case and spacing, numbers their format. */
export function normalizeValue(
  field: WorkplaceField,
  value: WorkplaceValue,
): string | number | null {
  if (value === null) return null;
  if (field === 'employerTaxCode') return normalizeTaxCode(String(value));
  if (field === 'employerName') return normalizeName(String(value));
  const type = DEFINITION.get(field)?.type;
  if (type === 'integer' || type === 'number' || type === 'amount') {
    const n = numberOf(value);
    return n === null ? null : round2(n);
  }
  if (type === 'date') return String(value).slice(0, 10);
  return String(value).toUpperCase().trim().replace(/\s+/g, ' ');
}

function workplaceValueOf(
  field: WorkplaceField,
  raw: string | number | boolean | null | undefined,
): string | number | null {
  const definition = DEFINITION.get(field);
  if (!definition) return null;
  switch (definition.type) {
    case 'date':
      return dateOf(raw);
    case 'integer': {
      const n = numberOf(raw);
      return n === null ? null : Math.round(n);
    }
    case 'number':
    case 'amount': {
      const n = numberOf(raw);
      return n === null || n === 0 ? null : round2(n);
    }
    case 'enum': {
      const value =
        text(raw)
          ?.toLowerCase()
          .replace(/[\s-]+/g, '_') ?? null;
      return (
        (CONTRACT_KINDS as readonly string[]).find((o) => o === value) ?? null
      );
    }
    default: {
      const value = text(raw);
      return field === 'employerTaxCode' ? normalizeTaxCode(value) : value;
    }
  }
}

/** What a work document prints, read from its template fields. */
export interface WorkDocumentReading {
  type: WorkDocumentType | null;
  /** Every workplace value it prints, under the JSON model's names. */
  values: PrintedValues;
  employerName: string | null;
  employerTaxCode: string | null;
  /** The month paid, for a payslip (YYYY-MM). */
  period: string | null;
  /** When it counts: the first day of the month paid, the evaluation, the contract's signature or start. */
  date: string | null;
  gross: number | null;
  deductions: number | null;
  net: number | null;
  taxable: number | null;
  incomeTax: number | null;
  contributions: number | null;
  welfare: number | null;
  severance: number | null;
  vacationLeft: number | null;
  leaveLeft: number | null;
  /** An evaluation's overall rating, with its scale. */
  rating: string | null;
  ratingScale: string | null;
  reviewer: string | null;
  strengths: string | null;
  improvements: string | null;
  goals: string | null;
  bonus: number | null;
  facts: WorkFactDto[];
}

const money = (n: number) =>
  n.toLocaleString('en-GB', { style: 'currency', currency: 'EUR' });

/** Which template keys of each type carry a workplace value (all, if not listed). */
const READ_BY_TYPE: Partial<
  Record<WorkDocumentType, readonly WorkplaceField[]>
> = {
  // An evaluation prints only what it grants; its employer and the new level, title or pay.
  PERFORMANCE_REVIEW: [
    'employerName',
    'employerTaxCode',
    'level',
    'jobTitle',
    'monthlySalary',
    'annualGrossSalary',
  ],
};

export function readWorkDocument(
  type: WorkDocumentType | null,
  fields: Fields | null,
): WorkDocumentReading {
  const f = fields ?? {};
  const values: PrintedValues = {};
  for (const field of READ_BY_TYPE[type ?? 'PAYSLIP'] ?? WORKPLACE_FIELDS) {
    const value = workplaceValueOf(field, f[DEFINITION.get(field)?.key ?? '']);
    if (value !== null) values[field] = value;
  }
  // A payslip prints `payer` on INCOME, `employer` on PAYSLIP and WORK.
  if (!values.employerName) {
    const payer = text(f['payer'] ?? f['issuer']);
    if (payer) values.employerName = payer;
  }
  const str = (key: string) => text(f[key]);
  const num = (key: string) => {
    const n = numberOf(f[key]);
    return n === null ? null : round2(n);
  };
  const facts: WorkFactDto[] = [];
  const fact = (label: string, value: string | number | null) => {
    if (value !== null && value !== '')
      facts.push({ label, value: String(value) });
  };
  const amountFact = (label: string, value: number | null) =>
    fact(label, value === null ? null : money(value));

  const reading: WorkDocumentReading = {
    type,
    values,
    employerName: (values.employerName as string) ?? null,
    employerTaxCode: (values.employerTaxCode as string) ?? null,
    period: null,
    date: null,
    gross: null,
    deductions: null,
    net: null,
    taxable: null,
    incomeTax: null,
    contributions: null,
    welfare: null,
    severance: null,
    vacationLeft: null,
    leaveLeft: null,
    rating: null,
    ratingScale: null,
    reviewer: null,
    strengths: null,
    improvements: null,
    goals: null,
    bonus: null,
    facts,
  };

  switch (type) {
    case 'PAYSLIP': {
      reading.period = monthOf(f[PAYSLIP_KEYS.period]);
      reading.date = reading.period ? `${reading.period}-01` : null;
      reading.gross = num(PAYSLIP_KEYS.gross);
      reading.deductions = num(PAYSLIP_KEYS.deductions);
      reading.net = num(PAYSLIP_KEYS.net);
      reading.taxable = num(PAYSLIP_KEYS.taxable);
      reading.incomeTax = num(PAYSLIP_KEYS.incomeTax);
      reading.contributions = num(PAYSLIP_KEYS.contributions);
      reading.welfare = num(PAYSLIP_KEYS.welfare);
      reading.severance = num(PAYSLIP_KEYS.severance);
      reading.vacationLeft = num(PAYSLIP_KEYS.vacationLeft);
      reading.leaveLeft = num(PAYSLIP_KEYS.leaveLeft);
      fact('Month paid', reading.period);
      amountFact('Gross', reading.gross);
      amountFact('Deductions', reading.deductions);
      amountFact('Net pay', reading.net);
      amountFact('Income tax (IRPEF)', reading.incomeTax);
      amountFact('Contributions', reading.contributions);
      amountFact('Welfare credits', reading.welfare);
      amountFact('Severance (TFR) this month', reading.severance);
      fact(
        'Vacation left',
        reading.vacationLeft === null ? null : `${reading.vacationLeft} h`,
      );
      fact(
        'Leave (ROL) left',
        reading.leaveLeft === null ? null : `${reading.leaveLeft} h`,
      );
      break;
    }
    case 'PERFORMANCE_REVIEW': {
      reading.date =
        dateOf(f['review_date']) ??
        dateOf(String(f['review_period'] ?? '').split('/')[1]);
      reading.rating = str('overall_rating');
      reading.ratingScale = str('rating_scale');
      reading.reviewer = str('reviewer');
      reading.strengths = str('strengths');
      reading.improvements = str('improvements');
      reading.goals = str('goals');
      reading.bonus = num('bonus_amount');
      fact('Date', reading.date);
      fact('Period', str('review_period'));
      fact(
        'Rating',
        reading.rating && reading.ratingScale
          ? `${reading.rating} (${reading.ratingScale})`
          : reading.rating,
      );
      fact('Reviewer', reading.reviewer);
      fact('Strengths', reading.strengths);
      fact('To improve', reading.improvements);
      fact('Goals', reading.goals);
      amountFact('Bonus', reading.bonus);
      break;
    }
    case 'EMPLOYMENT_CONTRACT': {
      reading.date =
        dateOf(f['signing_date']) ?? (values.hireDate as string) ?? null;
      fact('Signed', dateOf(f['signing_date']));
      fact('Starts', (values.hireDate as string) ?? null);
      fact('Ends', (values.endDate as string) ?? null);
      fact('Probation until', dateOf(f['probation_end']));
      break;
    }
    default:
      reading.date = dateOf(f['issue_date'] ?? f['payment_date']);
  }
  return reading;
}

/** Whether it names an employer, so it can make a new workplace. */
export function namesEmployer(reading: WorkDocumentReading): boolean {
  return Boolean(reading.employerName || reading.employerTaxCode);
}

/**
 * Which of your workplaces a document is about: the one with its employer's
 * tax code, else the one with its employer's name. A workplace you closed
 * matches too: an old payslip of a past job still belongs there.
 */
export function matchWorkplace<T extends { id: string; values: StoredValues }>(
  reading: Pick<WorkDocumentReading, 'employerName' | 'employerTaxCode'>,
  known: readonly T[],
): { workplace: T | null; match: WorkplaceMatch } {
  const code = normalizeTaxCode(reading.employerTaxCode);
  if (code) {
    const byCode = known.find(
      (w) =>
        normalizeTaxCode((w.values.employerTaxCode as string) ?? null) === code,
    );
    if (byCode) return { workplace: byCode, match: 'tax_code' };
  }
  const name = normalizeName(reading.employerName);
  if (name) {
    const byName = known.find(
      (w) => normalizeName((w.values.employerName as string) ?? null) === name,
    );
    if (byName) return { workplace: byName, match: 'name' };
  }
  return { workplace: null, match: 'none' };
}

/**
 * What a document would change on a workplace, field by field: a value it
 * does not have yet is taken; a different one is taken when the document is
 * the newest you have, kept when it is older, and to check on a value that
 * should never change (tax code, employee code, hire date).
 */
export function proposeWorkplaceChanges(
  printed: PrintedValues,
  workplace: StoredValues | null,
  outdated: boolean,
): WorkplaceChangeDto[] {
  const changes: WorkplaceChangeDto[] = [];
  for (const field of WORKPLACE_FIELDS) {
    const proposed = printed[field];
    if (proposed === undefined) continue;
    const current = workplace?.[field] ?? null;
    if (current === null) {
      changes.push({
        field,
        kind: 'new_value',
        current: null,
        proposed,
        suggestion: workplace && outdated ? 'keep_current' : 'accept',
      });
      continue;
    }
    if (normalizeValue(field, current) === normalizeValue(field, proposed))
      continue;
    const suggestion: WorkplaceChangeSuggestion = DEFINITION.get(field)?.stable
      ? 'check'
      : outdated
        ? 'keep_current'
        : 'accept';
    changes.push({
      field,
      kind: 'different_value',
      current,
      proposed,
      suggestion,
    });
  }
  return changes;
}

/**
 * Whether a document is older than the newest one you approved for the same
 * workplace: then its month-by-month values (level, pay) are history, not news.
 */
export function isOutdated(
  reading: Pick<WorkDocumentReading, 'date'>,
  approved: readonly { reading: Pick<WorkDocumentReading, 'date'> }[],
): boolean {
  if (!reading.date) return false;
  return approved.some((d) => d.reading.date && d.reading.date > reading.date!);
}

/** Every value of the workplace, with null for the ones not known yet. */
export function completeValues(values: StoredValues): WorkplaceValues {
  return Object.fromEntries(
    WORKPLACE_FIELDS.map((field) => [field, values[field] ?? null]),
  ) as WorkplaceValues;
}

/** The value as stored: text trimmed, numbers as numbers, empty as null. */
export function cleanValue(
  field: WorkplaceField,
  value: string | number | null | undefined,
): WorkplaceValue {
  if (value === null || value === undefined) return null;
  return workplaceValueOf(field, value);
}

export function todayIso(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}
