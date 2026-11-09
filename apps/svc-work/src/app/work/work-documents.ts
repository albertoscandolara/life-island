import {
  CONTRACT_KINDS,
  PAYSLIP_KEYS,
  PAYSLIP_KINDS,
  PAYSLIP_KIND_LABELS,
  TAX_CERTIFICATE_KEYS,
  WORK_DOCUMENT_ROOT,
  WORK_DOCUMENT_TYPES,
  WORKPLACE_FIELD_DEFINITIONS,
  WORKPLACE_FIELDS,
  type PayslipKind,
  type WorkDocumentType,
  type WorkFactDto,
  type WorkplaceChangeDto,
  type WorkplaceChangeSuggestion,
  type WorkplaceField,
  type WorkplaceMatch,
  type WorkplaceValue,
  type WorkplaceValues,
  type EvaluationRulesDto,
  type RuleItemDto,
  type ScoreBandDto,
  type ScoreItemDto,
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

const LEVEL_CODE = String.raw`(?:[A-Z]{1,2}\d{1,2}|\d{1,2}[A-Z]{0,2}|Q(?:UADRO)?)`;

/**
 * A level as its code on the CCNL scale: payslips print it with a prefix or a
 * note ("IMP.LIV.C3 L. 56/87", "LIVELLO 5S"), and a model copies it one way
 * on a payslip and another on the next, so "IMP.LIV.C3" and "C3" read as a
 * level change. Anything else (Quadro, a grade name) is kept as printed.
 */
export function levelCode(value: string | null): string | null {
  if (!value) return null;
  const upper = value.toUpperCase().trim();
  const labelled = new RegExp(`\\bLIV(?:ELLO|\\.)?\\s*(${LEVEL_CODE})\\b`).exec(
    upper,
  );
  if (labelled) return labelled[1];
  if (new RegExp(`^${LEVEL_CODE}$`).test(upper.replace(/\s+/g, '')))
    return upper.replace(/\s+/g, '');
  return value;
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
      if (field === 'level') return levelCode(value);
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
  /** What a payslip pays: the month, or only an extra month (see PAYSLIP_KINDS). */
  payslipKind: PayslipKind | null;
  /** A Certificazione Unica, read. */
  certificate: CertificateReading | null;
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
  /** A payslip's hours, overtime and travel (see PAYSLIP_KEYS). */
  hoursWorked: number | null;
  overtimeHours: number | null;
  overtimePay: number | null;
  travelDays: number | null;
  travelAllowance: number | null;
  /** An evaluation's overall rating, with its scale. */
  rating: string | null;
  ratingScale: string | null;
  reviewer: string | null;
  strengths: string | null;
  improvements: string | null;
  goals: string | null;
  bonus: number | null;
  /** An evaluation's period and scores (see `readScores`). */
  cycle: string | null;
  periodStart: string | null;
  periodEnd: string | null;
  role: string | null;
  team: string | null;
  score: number | null;
  maxScore: number | null;
  sections: ScoreItemDto[];
  criteria: ScoreItemDto[];
  payoutPct: number | null;
  bonusTarget: number | null;
  comments: string | null;
  /** An evaluation rules document, read (see `readBands`, `readRuleItems`). */
  rules: RulesReading | null;
  facts: WorkFactDto[];
}

/** What a Certificazione Unica prints (see TAX_CERTIFICATE_KEYS). */
export interface CertificateReading {
  year: number | null;
  income: number | null;
  days: number | null;
  irpefWithheld: number | null;
  regionalSurtax: number | null;
  municipalSurtax: number | null;
  grossTax: number | null;
  totalDeductions: number | null;
  netTax: number | null;
}

/**
 * A payslip's kind as printed: one of PAYSLIP_KINDS, or the words a model
 * may write instead ("tredicesima", "13th", "14.ma mensilità"). Nothing is
 * regular.
 */
export function payslipKindOf(value: unknown): PayslipKind {
  const raw = typeof value === 'string' ? value.trim().toLowerCase() : '';
  const exact = PAYSLIP_KINDS.find((k) => k === raw.replace(/[\s-]+/g, '_'));
  if (exact) return exact;
  if (/tredicesim|\b13|thirteen|natalizi|christmas/.test(raw))
    return 'thirteenth';
  if (/quattordicesim|\b14|fourteen/.test(raw)) return 'fourteenth';
  if (
    /bonus|premi|arretrat|arrears|conguagl|settlement|liquidaz|other/.test(raw)
  )
    return 'other';
  return 'regular';
}

export type RulesReading = Omit<
  EvaluationRulesDto,
  'uploadId' | 'title' | 'workplaceId' | 'workplaceName'
>;

/**
 * Scores written one per line as "Name: score" or "Name: score/max" (also
 * "Name - 4 / 5", "Name = 4"); separators may be new lines or semicolons.
 * Lines without a number are skipped; a repeated name keeps its first score.
 */
export function readScores(value: unknown): ScoreItemDto[] {
  const raw = typeof value === 'string' ? value : '';
  const items: ScoreItemDto[] = [];
  const seen = new Set<string>();
  for (const line of raw.split(/\r?\n|;/)) {
    const match =
      /^\s*[-•*]?\s*(.+?)\s*[:=–-]\s*(-?\d+(?:[.,]\d+)?)\s*(?:\/\s*(\d+(?:[.,]\d+)?))?\s*(?:pt[is]?\.?|punti)?\s*$/i.exec(
        line,
      );
    if (!match) continue;
    const name = match[1].replace(/\s+/g, ' ').trim();
    const score = Number(match[2].replace(',', '.'));
    const max = match[3] ? Number(match[3].replace(',', '.')) : null;
    const key = name.toLowerCase();
    if (!name || !Number.isFinite(score) || seen.has(key)) continue;
    seen.add(key);
    items.push({ name, score: round2(score), max });
  }
  return items;
}

const NUMBER = String.raw`(\d+(?:[.,]\d+)?)`;
const toNumber = (raw: string) => Number(raw.replace(',', '.'));

/** Lines of a text field, without bullets or blanks. */
export function readLines(value: unknown): string[] {
  const raw = typeof value === 'string' ? value : '';
  return raw
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s*[-•*]\s*/, '').trim())
    .filter(Boolean);
}

/**
 * A conversion table written one band per line: "116-120: 100", "da 81 a 85:
 * 65%", "< 60: 0", ">= 116: 100%". Lowest band first; lines without a share
 * are skipped.
 */
export function readBands(value: unknown): ScoreBandDto[] {
  const bands: ScoreBandDto[] = [];
  for (const line of readLines(value)) {
    const sides = /^(.*?)\s*(?::|=|→|->)\s*(-?\d+(?:[.,]\d+)?)\s*%?\s*$/.exec(
      line,
    );
    if (!sides) continue;
    const range = sides[1].toLowerCase();
    const pct = toNumber(sides[2]);
    const between = new RegExp(
      `${NUMBER}\\s*(?:-|–|a|to|al)\\s*${NUMBER}`,
    ).exec(range);
    const below = new RegExp(
      `(?:<=?|≤|below|sotto|meno di|under)\\s*${NUMBER}`,
    ).exec(range);
    const above = new RegExp(
      `(?:>=?|≥|from|da|oltre|over|above)\\s*${NUMBER}`,
    ).exec(range);
    if (between)
      bands.push({ min: toNumber(between[1]), max: toNumber(between[2]), pct });
    else if (below)
      bands.push({
        min: null,
        max: toNumber(below[1]) - (/<=|≤/.test(range) ? 0 : 1),
        pct,
      });
    else if (above) bands.push({ min: toNumber(above[1]), max: null, pct });
  }
  return bands.sort((a, b) => (a.min ?? -Infinity) - (b.min ?? -Infinity));
}

/**
 * Lines as "Name: value – note", "Name: note" or "value: note" (a mark and
 * what it means): sections with their highest score, or a scale.
 */
export function readRuleItems(value: unknown): RuleItemDto[] {
  const items: RuleItemDto[] = [];
  for (const line of readLines(value)) {
    const at = line.indexOf(':');
    if (at <= 0) {
      items.push({ name: line, value: null, note: null });
      continue;
    }
    const name = line.slice(0, at).trim();
    const rest = line.slice(at + 1).trim();
    const lead = new RegExp(
      `^(?:max\\.?\\s*)?${NUMBER}\\s*(?:pt[is]?\\.?|punti|points)?\\s*(?:[-–—,;(]\\s*(.*?)\\)?)?$`,
      'i',
    ).exec(rest);
    const markOnly = /^(?:\D*?)(\d+(?:[.,]\d+)?)$/.exec(name);
    if (lead)
      items.push({
        name,
        value: toNumber(lead[1]),
        note: lead[2]?.trim() || null,
      });
    else if (markOnly && name.length <= 12)
      items.push({ name, value: toNumber(markOnly[1]), note: rest || null });
    else items.push({ name, value: null, note: rest || null });
  }
  return items;
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
  // Rules only tell whose they are.
  EVALUATION_RULES: ['employerName', 'employerTaxCode'],
  // A CU's dates are of the year it covers, not of the employment.
  CERTIFICAZIONE_UNICA: ['employerName', 'employerTaxCode'],
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
    payslipKind: null,
    certificate: null,
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
    hoursWorked: null,
    overtimeHours: null,
    overtimePay: null,
    travelDays: null,
    travelAllowance: null,
    rating: null,
    ratingScale: null,
    reviewer: null,
    strengths: null,
    improvements: null,
    goals: null,
    bonus: null,
    cycle: null,
    periodStart: null,
    periodEnd: null,
    role: null,
    team: null,
    score: null,
    maxScore: null,
    sections: [],
    criteria: [],
    payoutPct: null,
    bonusTarget: null,
    comments: null,
    rules: null,
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
      reading.hoursWorked = num(PAYSLIP_KEYS.hoursWorked);
      reading.overtimeHours = num(PAYSLIP_KEYS.overtimeHours);
      reading.overtimePay = num(PAYSLIP_KEYS.overtimePay);
      reading.travelDays = num(PAYSLIP_KEYS.travelDays);
      reading.travelAllowance = num(PAYSLIP_KEYS.travelAllowance);
      reading.payslipKind = payslipKindOf(f[PAYSLIP_KEYS.kind]);
      fact('Month paid', reading.period);
      if (reading.payslipKind !== 'regular')
        fact('Kind', PAYSLIP_KIND_LABELS[reading.payslipKind]);
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
      fact(
        'Overtime',
        reading.overtimeHours === null ? null : `${reading.overtimeHours} h`,
      );
      amountFact('Travel allowances', reading.travelAllowance);
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
      // One goal per line, kept apart for the goals tracker.
      reading.goals =
        readLines(f['goals'])
          .map((line) => line.replace(/\s+/g, ' '))
          .join('\n') || null;
      reading.bonus = num('bonus_amount');
      const [start, end] = String(f['review_period'] ?? '').split('/');
      reading.periodStart = dateOf(start);
      reading.periodEnd = dateOf(end);
      reading.cycle = str('review_cycle');
      reading.role = str('role') ?? ((values.jobTitle as string) || null);
      reading.team = str('team');
      reading.score =
        num('overall_score') ??
        (reading.rating && /^\d+(?:[.,]\d+)?$/.test(reading.rating)
          ? round2(Number(reading.rating.replace(',', '.')))
          : null);
      reading.maxScore = num('max_score');
      reading.sections = readScores(f['section_scores']);
      reading.criteria = readScores(f['criteria_scores']);
      reading.payoutPct = num('payout_percent');
      reading.bonusTarget = num('bonus_target');
      reading.comments = str('comments');
      fact('Date', reading.date);
      fact('Period', str('review_period'));
      fact('Cycle', reading.cycle);
      fact('Role', reading.role);
      fact('Team', reading.team);
      fact(
        'Score',
        reading.score === null
          ? null
          : reading.maxScore
            ? `${reading.score} / ${reading.maxScore}`
            : reading.score,
      );
      fact(
        'Bonus conversion',
        reading.payoutPct === null ? null : `${reading.payoutPct}%`,
      );
      amountFact('Bonus target', reading.bonusTarget);
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
      fact('Comments', reading.comments);
      amountFact('Bonus', reading.bonus);
      break;
    }
    case 'EVALUATION_RULES': {
      const effectiveFrom = dateOf(f['effective_from']);
      reading.date = effectiveFrom ?? dateOf(f['issue_date']);
      const rules: RulesReading = {
        version: str('version'),
        effectiveFrom: reading.date,
        maxScore: num('max_score'),
        maxPayoutPct: num('max_payout_percent'),
        targetRule: str('bonus_target_rule'),
        scale: readRuleItems(f['score_scale']),
        sections: readRuleItems(f['sections']),
        bands: readBands(f['conversion_table']),
        schedule: readLines(f['payout_schedule']),
        eligibility: readLines(f['eligibility']),
        notes: readLines(f['notes']),
      };
      reading.rules = rules;
      reading.maxScore = rules.maxScore;
      fact('Version', rules.version);
      fact('Applies from', rules.effectiveFrom);
      fact('Highest score', rules.maxScore);
      fact('Bonus target', rules.targetRule);
      fact(
        'Highest payout',
        rules.maxPayoutPct === null ? null : `${rules.maxPayoutPct}%`,
      );
      fact(
        'Sections',
        rules.sections
          .map((i) => (i.value === null ? i.name : `${i.name} (${i.value})`))
          .join(', ') || null,
      );
      fact(
        'Conversion',
        rules.bands.length
          ? `${rules.bands.length} bands, ${rules.bands.at(-1)!.pct}% from ${rules.bands.at(-1)!.min ?? 0} points`
          : null,
      );
      break;
    }
    case 'CERTIFICAZIONE_UNICA': {
      const K = TAX_CERTIFICATE_KEYS;
      const year = numberOf(f[K.incomeYear]);
      const sum = (...keys: string[]) => {
        const parts = keys.map(num).filter((n): n is number => n !== null);
        return parts.length ? round2(parts.reduce((a, b) => a + b, 0)) : null;
      };
      const certificate: CertificateReading = {
        year:
          year !== null && year >= 1990 && year <= 2100
            ? Math.round(year)
            : null,
        income: num(K.employmentIncome),
        days: num(K.days),
        irpefWithheld: num(K.irpefWithheld),
        regionalSurtax: num(K.regionalSurtax),
        municipalSurtax: num(K.municipalSurtax),
        grossTax: num(K.grossTax),
        totalDeductions:
          num(K.totalDeductions) ?? sum(K.workDeductions, K.familyDeductions),
        netTax: num(K.netTax),
      };
      reading.certificate = certificate;
      reading.date =
        dateOf(f[K.issueDate]) ??
        (certificate.year ? `${certificate.year}-12-31` : null);
      fact('Income year', certificate.year);
      amountFact('Employment income', certificate.income);
      fact('Days', certificate.days);
      amountFact('IRPEF withheld', certificate.irpefWithheld);
      amountFact('Regional surtax', certificate.regionalSurtax);
      amountFact('Municipal surtax', certificate.municipalSurtax);
      amountFact('Gross tax', certificate.grossTax);
      amountFact('Tax credits', certificate.totalDeductions);
      amountFact('Net tax', certificate.netTax);
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
