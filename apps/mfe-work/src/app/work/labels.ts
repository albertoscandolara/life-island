import {
  CAREER_EVENT_LABELS,
  CONTRACT_KIND_LABELS,
  WORK_DOCUMENT_TYPE_LABELS,
  WORKPLACE_FIELD_DEFINITIONS,
  type CareerEventKind,
  type WorkDocumentType,
  type WorkplaceField,
  type WorkplaceValue,
} from '@life-island/contracts';
import type { UiTone } from '@life-island/design-system';

const DEFINITION = new Map(
  WORKPLACE_FIELD_DEFINITIONS.map((d) => [d.field as WorkplaceField, d]),
);

export function fieldLabel(field: WorkplaceField): string {
  return DEFINITION.get(field)?.label ?? field;
}

/** "Payslip", or "Work document" when only the WORK subject is known. */
export function typeLabel(type: WorkDocumentType | null): string {
  return type ? WORK_DOCUMENT_TYPE_LABELS[type] : 'Work document';
}

/** Your name for the workplace, else the employer as printed. */
export function workplaceName(workplace: {
  label: string | null;
  values: Partial<Record<WorkplaceField, WorkplaceValue>>;
}): string {
  return (
    workplace.label ||
    (workplace.values.employerName as string | null) ||
    'Unnamed workplace'
  );
}

/** 2.518,53 rather than 2518,53: Italian grouping skips four-digit numbers by default. */
const GROUP_THOUSANDS = {
  useGrouping: 'always',
} as unknown as Intl.NumberFormatOptions;

export function euro(value: number | null | undefined): string {
  if (value === null || value === undefined) return '–';
  return value.toLocaleString('it-IT', {
    style: 'currency',
    currency: 'EUR',
    ...GROUP_THOUSANDS,
  });
}

/** Without cents, for chart axes and tiles. */
export function euroShort(value: number): string {
  return value.toLocaleString('it-IT', {
    style: 'currency',
    currency: 'EUR',
    ...GROUP_THOUSANDS,
    maximumFractionDigits: 0,
  });
}

/** "6 years 8 months", "5 months". */
export function duration(months: number | null): string {
  if (months === null) return '–';
  const years = Math.floor(months / 12);
  const rest = months % 12;
  const y = years ? `${years} ${years === 1 ? 'year' : 'years'}` : '';
  const m = rest ? `${rest} ${rest === 1 ? 'month' : 'months'}` : '';
  return [y, m].filter(Boolean).join(' ') || 'less than a month';
}

const MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

/** 2026-06 as "Jun 2026"; 2026-06-15 as "15 Jun 2026". */
export function periodText(value: string | null): string {
  if (!value) return '–';
  const [y, m, d] = value.split('-');
  const month = MONTHS[Number(m) - 1] ?? m;
  return d ? `${Number(d)} ${month} ${y}` : `${month} ${y}`;
}

/** "Jun 26": the short label of a month on the chart. */
export function shortPeriod(period: string): string {
  const [y, m] = period.split('-');
  return `${MONTHS[Number(m) - 1] ?? m} ${y.slice(2)}`;
}

/** A value of a workplace as you read it: amounts in euro, dates in full, contract kinds in words. */
export function valueText(
  field: WorkplaceField,
  value: WorkplaceValue,
): string {
  if (value === null || value === '') return '';
  const type = DEFINITION.get(field)?.type;
  if (type === 'amount' && typeof value === 'number') return euro(value);
  if (type === 'date') return periodText(String(value));
  if (type === 'enum')
    return (
      CONTRACT_KIND_LABELS[value as keyof typeof CONTRACT_KIND_LABELS] ??
      String(value)
    );
  if (field === 'partTimePercentage') return `${value}%`;
  if (field === 'weeklyHours') return `${value} h`;
  return String(value);
}

export function eventLabel(kind: CareerEventKind): string {
  return CAREER_EVENT_LABELS[kind];
}

/** The colour of an event on the timeline. */
export function eventTone(kind: CareerEventKind): UiTone {
  switch (kind) {
    case 'promotion':
    case 'salary_rise':
    case 'hired':
    case 'award':
    case 'certification':
      return 'success';
    case 'salary_cut':
    case 'left':
      return 'danger';
    case 'evaluation':
    case 'contract_signed':
    case 'role_change':
      return 'info';
    case 'extra_pay':
    case 'seniority_increment':
      return 'progress';
    default:
      return 'neutral';
  }
}

/** The emblem of an event on the timeline. */
export function eventEmblem(kind: CareerEventKind): string {
  const emblems: Partial<Record<CareerEventKind, string>> = {
    hired: '🤝',
    left: '👋',
    promotion: '🚀',
    level_change: '↕️',
    salary_rise: '📈',
    salary_cut: '📉',
    role_change: '🧭',
    contract_change: '📜',
    seniority_increment: '⏳',
    extra_pay: '🎁',
    evaluation: '📝',
    contract_signed: '✍️',
    award: '🏆',
    course: '🎓',
    certification: '📜',
    project: '🛠️',
  };
  return emblems[kind] ?? '•';
}

/** Whether a URL is safe to open from a link: only web addresses. */
export function safeUrl(url: string): string | null {
  return /^https?:\/\//i.test(url) ? url : null;
}

/** A change in percent, signed: "+12,7%". */
export function pct(value: number | null): string {
  if (value === null) return '–';
  return `${value > 0 ? '+' : ''}${value.toLocaleString('it-IT')}%`;
}

/** Hours of leave: "64 h". */
export function hours(value: number | null): string {
  return value === null ? '–' : `${value.toLocaleString('it-IT')} h`;
}

/** A score as printed: "86,4", or "86,4 / 120" with its highest. */
export function scoreText(
  score: number | null,
  max: number | null = null,
): string {
  if (score === null) return '–';
  const text = score.toLocaleString('it-IT');
  return max ? `${text} / ${max.toLocaleString('it-IT')}` : text;
}

/** A score change, signed: "+4", "−2,5". */
export function signed(value: number | null): string {
  if (value === null) return '–';
  if (value === 0) return '0';
  return `${value > 0 ? '+' : '−'}${Math.abs(value).toLocaleString('it-IT')}`;
}

/** "2.518,53" (Italian) or "2518.53" as 2518.53. */
export function parseNumber(raw: string): number {
  const text = raw.trim();
  return Number(
    text.includes(',') ? text.replace(/\./g, '').replace(',', '.') : text,
  );
}

/** An amount you typed, or null when blank or not a number. "35k" is 35,000. */
export function parseAmount(raw: string): number | null {
  const text = raw.trim().replace(/€|\s/g, '');
  if (!text) return null;
  const thousands = /k$/i.test(text);
  const digits = thousands ? text.slice(0, -1) : text;
  // "38.000" is thirty-eight thousand, not 38: dots before groups of three.
  const n = parseNumber(
    /^\d{1,3}(\.\d{3})+$/.test(digits) ? digits.replace(/\./g, '') : digits,
  );
  return Number.isFinite(n) ? (thousands ? n * 1000 : n) : null;
}
