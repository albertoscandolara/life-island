import {
  EXPIRY_WARNING_DAYS,
  ID_DOCUMENT_FIELD_KEYS,
  ID_DOCUMENT_ROOT,
  ID_DOCUMENT_TYPES,
  PERSON_FIELD_KEYS,
  PERSON_FIELDS,
  type ChangeSuggestion,
  type ExpiryAlertDto,
  type IdDocumentStatus,
  type IdDocumentType,
  type PersonField,
  type PersonMatch,
  type PersonValues,
  type ProposedChangeDto,
} from '@life-island/contracts';

/*
 * Pure rules of the People area: which documents are ID documents, what they
 * print about their holder, who that holder is, what would change, and how
 * versions and expiry warnings are worked out. No database here, so every
 * rule is unit-tested on its own.
 */

export type Fields = Record<string, string | number | boolean | null>;
export type ParentOf = ReadonlyMap<string, string | null>;

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
 * Whether a document is an ID document and of which type: one of its
 * categories is, or sits under, IDENTITY_CARD, PASSPORT, HEALTH_CARD,
 * DRIVING_LICENCE, or the ID_DOCUMENT root (then the type is unknown).
 */
export function idDocumentType(
  categories: readonly string[],
  parentOf: ParentOf,
): { isId: boolean; type: IdDocumentType | null } {
  let isId = false;
  for (const id of categories) {
    const chain = withAncestors(id, parentOf);
    const type = chain.find((c): c is IdDocumentType =>
      (ID_DOCUMENT_TYPES as readonly string[]).includes(c),
    );
    if (type) return { isId: true, type };
    if (chain.includes(ID_DOCUMENT_ROOT)) isId = true;
  }
  return { isId, type: null };
}

function text(value: string | number | boolean | null | undefined) {
  if (value === null || value === undefined) return null;
  const trimmed = String(value).trim().replace(/\s+/g, ' ');
  return trimmed === '' ? null : trimmed;
}

/** How a value is compared: names and codes ignore case and spacing. */
export function normalizeValue(
  field: PersonField,
  value: string | null,
): string | null {
  if (value === null) return null;
  const upper = value.toUpperCase().trim().replace(/\s+/g, ' ');
  if (field === 'taxCode') return upper.replace(/\s/g, '');
  if (field === 'birthDate') return value.trim().slice(0, 10);
  return upper.replace(/[’']/g, "'");
}

export interface IdDocumentReading {
  holder: PersonValues;
  documentNumber: string | null;
  issuer: string | null;
  issuingCountry: string | null;
  issueDate: string | null;
  expiryDate: string | null;
}

function dateOf(value: string | number | boolean | null | undefined) {
  const raw = text(value);
  return raw && /^\d{4}-\d{2}-\d{2}/.test(raw) ? raw.slice(0, 10) : null;
}

/** What an ID document prints, read from its template fields. */
export function readIdDocument(fields: Fields | null): IdDocumentReading {
  const f = fields ?? {};
  const holder = Object.fromEntries(
    PERSON_FIELDS.map((field) => {
      const raw = f[PERSON_FIELD_KEYS[field]];
      const value = field === 'birthDate' ? dateOf(raw) : text(raw);
      return [
        field,
        field === 'taxCode' && value
          ? value.toUpperCase().replace(/\s/g, '')
          : value,
      ];
    }),
  ) as PersonValues;
  return {
    holder,
    documentNumber:
      text(f[ID_DOCUMENT_FIELD_KEYS.documentNumber])?.replace(/\s/g, '') ??
      null,
    issuer: text(f[ID_DOCUMENT_FIELD_KEYS.issuer]),
    issuingCountry: text(f[ID_DOCUMENT_FIELD_KEYS.issuingCountry]),
    issueDate: dateOf(f[ID_DOCUMENT_FIELD_KEYS.issueDate]),
    expiryDate: dateOf(f[ID_DOCUMENT_FIELD_KEYS.expiryDate]),
  };
}

export interface KnownPerson extends PersonValues {
  id: string;
}

/**
 * Who the holder is: the person with the same tax code, else the only person
 * with the same last name, first name and birth date (a passport or a
 * licence prints no tax code). No match: a new person.
 */
export function matchPerson(
  holder: PersonValues,
  people: readonly KnownPerson[],
): { person: KnownPerson | null; match: PersonMatch } {
  const taxCode = normalizeValue('taxCode', holder.taxCode);
  if (taxCode) {
    const byCode = people.find(
      (p) => normalizeValue('taxCode', p.taxCode) === taxCode,
    );
    if (byCode) return { person: byCode, match: 'tax_code' };
  }
  const same = (p: KnownPerson, field: PersonField) => {
    const a = normalizeValue(field, holder[field]);
    return a !== null && a === normalizeValue(field, p[field]);
  };
  const byName = people.filter(
    (p) =>
      same(p, 'lastName') &&
      same(p, 'firstName') &&
      same(p, 'birthDate') &&
      // A different printed tax code is another person, whatever the name.
      !(
        taxCode &&
        p.taxCode &&
        normalizeValue('taxCode', p.taxCode) !== taxCode
      ),
  );
  if (byName.length === 1)
    return { person: byName[0], match: 'name_and_birth_date' };
  return { person: null, match: 'none' };
}

/** Never change by themselves: a difference is a misread or another person. */
const STABLE_FIELDS: readonly PersonField[] = [
  'lastName',
  'firstName',
  'taxCode',
  'birthDate',
  'birthPlace',
  'sex',
];

/**
 * What the document would change on the person, field by field, with a
 * suggestion: take a new value; for a different one, check it if it should
 * never change (name, tax code, birth...) or take it if it can (residence,
 * citizenship). An outdated document (expired, or older than the one you
 * have) suggests keeping your data.
 */
export function proposeChanges(
  holder: PersonValues,
  person: PersonValues | null,
  outdated: boolean,
): ProposedChangeDto[] {
  const changes: ProposedChangeDto[] = [];
  for (const field of PERSON_FIELDS) {
    const proposed = holder[field];
    if (proposed === null) continue;
    const current = person ? person[field] : null;
    if (current === null) {
      changes.push({
        field,
        kind: 'new_value',
        current: null,
        proposed,
        suggestion: person && outdated ? 'keep_current' : 'accept',
      });
      continue;
    }
    if (normalizeValue(field, current) === normalizeValue(field, proposed))
      continue;
    const suggestion: ChangeSuggestion = STABLE_FIELDS.includes(field)
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

/** Days from `today` to `date` (both YYYY-MM-DD); negative once past. */
export function daysUntil(date: string, today: string): number {
  const ms = (d: string) =>
    Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10));
  return Math.round((ms(date) - ms(today)) / 86_400_000);
}

export function todayIso(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

export interface ApprovedDocument {
  uploadId: string;
  type: IdDocumentType | null;
  issueDate: string | null;
  expiryDate: string | null;
  uploadedAt: string;
  /** Lost, stolen or withdrawn, as you marked it. */
  markedStatus: IdDocumentStatus | null;
}

export interface Version<T extends ApprovedDocument> {
  document: T;
  version: number;
  status: IdDocumentStatus;
}

/** The order of versions: by issue date, else expiry date, else upload. */
function versionKey(d: ApprovedDocument): string {
  return `${d.issueDate ?? d.expiryDate ?? ''}|${d.uploadedAt}`;
}

/**
 * One person's approved ID documents as series (one per type), each with its
 * versions numbered from the oldest, newest first. The newest is current, or
 * expired once past its date; the older ones are superseded. Your marks
 * (lost, stolen, withdrawn) win.
 */
export function buildSeries<T extends ApprovedDocument>(
  documents: readonly T[],
  today: string,
): { type: IdDocumentType | null; versions: Version<T>[] }[] {
  const byType = new Map<IdDocumentType | null, T[]>();
  for (const d of documents) {
    const list = byType.get(d.type) ?? [];
    list.push(d);
    byType.set(d.type, list);
  }
  const order = [...ID_DOCUMENT_TYPES, null];
  return [...byType.entries()]
    .sort(([a], [b]) => order.indexOf(a) - order.indexOf(b))
    .map(([type, list]) => {
      const sorted = [...list].sort((a, b) =>
        versionKey(a).localeCompare(versionKey(b)),
      );
      const versions = sorted.map((document, index) => {
        const latest = index === sorted.length - 1;
        const status: IdDocumentStatus =
          document.markedStatus ??
          (!latest
            ? 'superseded'
            : document.expiryDate && document.expiryDate < today
              ? 'expired'
              : 'current');
        return { document, version: index + 1, status };
      });
      return { type, versions: versions.reverse() };
    });
}

/**
 * Warnings for the latest version of each series only: expired (past its
 * expiry date) or expiring (within the type's window, EXPIRY_WARNING_DAYS).
 * A document you marked lost, stolen or withdrawn, or one with no expiry date,
 * never warns.
 */
export function expiryAlerts(
  person: { id: string; firstName: string | null; lastName: string | null },
  series: readonly {
    type: IdDocumentType | null;
    versions: Version<ApprovedDocument>[];
  }[],
  today: string,
): ExpiryAlertDto[] {
  const alerts: ExpiryAlertDto[] = [];
  for (const { type, versions } of series) {
    const latest = versions[0];
    if (!latest || !['current', 'expired'].includes(latest.status)) continue;
    const expiryDate = latest.document.expiryDate;
    if (!expiryDate) continue;
    const daysLeft = daysUntil(expiryDate, today);
    const window = type ? EXPIRY_WARNING_DAYS[type] : 90;
    if (daysLeft > window) continue;
    alerts.push({
      level: daysLeft < 0 ? 'expired' : 'expiring',
      personId: person.id,
      personName: [person.firstName, person.lastName].filter(Boolean).join(' '),
      uploadId: latest.document.uploadId,
      type,
      expiryDate,
      daysLeft,
    });
  }
  return alerts.sort((a, b) => a.daysLeft - b.daysLeft);
}

/**
 * A document is outdated for its holder's data when it has expired, or when
 * the person already has a newer document of the same type.
 */
export function isOutdated(
  reading: Pick<IdDocumentReading, 'issueDate' | 'expiryDate'>,
  type: IdDocumentType | null,
  approved: readonly ApprovedDocument[],
  today: string,
): boolean {
  if (reading.expiryDate && reading.expiryDate < today) return true;
  const issued = reading.issueDate;
  if (!issued) return false;
  return approved.some(
    (d) => d.type === type && d.issueDate !== null && d.issueDate > issued,
  );
}

/**
 * What a merge keeps: the person you merge into keeps every value they have,
 * and takes from the duplicate only what they do not know yet. Two different
 * tax codes mean two different people, so they are never merged.
 */
export function mergedValues(
  into: PersonValues,
  from: PersonValues,
): { values: PersonValues; taken: PersonField[] } | { conflict: 'taxCode' } {
  if (into.taxCode && from.taxCode && into.taxCode !== from.taxCode)
    return { conflict: 'taxCode' };
  const values = { ...into };
  const taken: PersonField[] = [];
  for (const field of PERSON_FIELDS)
    if (values[field] === null && from[field] !== null) {
      values[field] = from[field];
      taken.push(field);
    }
  return { values, taken };
}
