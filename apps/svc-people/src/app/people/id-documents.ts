import {
  EXPIRY_WARNING_DAYS,
  ID_DOCUMENT_FIELD_KEYS,
  ID_DOCUMENT_ROOT,
  ID_DOCUMENT_TYPES,
  PERSON_FIELD_KEYS,
  PERSON_FIELDS,
  type ChangeSuggestion,
  LICENCE_CATEGORY_LABELS,
  restrictionMeaning,
  type ExpiryAlertDto,
  type IdDocumentDetailsDto,
  type IdDocumentStatus,
  type LicenceCategoryDto,
  type PersonLicenceDto,
  type PersonNoticeDto,
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

/**
 * How a value is compared: names, places and codes ignore case, accents,
 * apostrophes, punctuation and spacing ("D'Angelo" = "DANGELO", "Rossì" =
 * "ROSSI").
 */
export function normalizeValue(
  field: PersonField,
  value: string | null,
): string | null {
  if (value === null) return null;
  const upper = value.toUpperCase().trim().replace(/\s+/g, ' ');
  if (field === 'taxCode') return upper.replace(/\s/g, '');
  if (field === 'birthDate') return value.trim().slice(0, 10);
  return upper
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Z0-9]+/g, '');
}

export interface IdDocumentReading {
  holder: PersonValues;
  documentNumber: string | null;
  issuer: string | null;
  issuingCountry: string | null;
  issueDate: string | null;
  expiryDate: string | null;
  details: IdDocumentDetailsDto;
}

function dateOf(value: string | number | boolean | null | undefined) {
  const raw = text(value);
  return raw && /^\d{4}-\d{2}-\d{2}/.test(raw) ? raw.slice(0, 10) : null;
}

/** A date as printed: ISO, or the Italian 31/12/2030 and 31.12.2030. */
export function looseDate(value: string): string | null {
  const iso = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const it = value.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/);
  if (it) return `${it[3]}-${it[2].padStart(2, '0')}-${it[1].padStart(2, '0')}`;
  return null;
}

/** "AM, B" (field 9): the categories held, in capitals, without repeats. */
export function parseCategories(value: string | null): string[] {
  if (!value) return [];
  return [
    ...new Set(
      value
        .toUpperCase()
        .split(/[\s,;/]+/)
        .map((c) => c.trim())
        .filter((c) => /^[A-Z][A-Z0-9]{0,2}$/.test(c)),
    ),
  ];
}

/**
 * "C: 2028-05-01, D 01/05/2027" (field 11): the categories whose own expiry
 * differs from the licence's.
 */
export function parseCategoryExpiries(
  value: string | null,
): Map<string, string> {
  const map = new Map<string, string>();
  if (!value) return map;
  for (const part of value.split(/[,;\n]+/)) {
    const match = part
      .trim()
      .match(/^([A-Za-z][A-Za-z0-9]{0,2})\s*[:=]?\s*(\S+)$/);
    if (!match) continue;
    const date = looseDate(match[2]);
    if (date) map.set(match[1].toUpperCase(), date);
  }
  return map;
}

function licenceCategories(
  f: Fields,
  expiryDate: string | null,
): LicenceCategoryDto[] {
  const own = parseCategoryExpiries(text(f['category_expiries']));
  const held = parseCategories(text(f['licence_categories']));
  for (const category of own.keys())
    if (!held.includes(category)) held.push(category);
  return held.map((category) => ({
    category,
    meaning: LICENCE_CATEGORY_LABELS[category] ?? null,
    expiryDate: own.get(category) ?? expiryDate,
  }));
}

function bool(value: string | number | boolean | null | undefined) {
  if (typeof value === 'boolean') return value;
  const raw = text(value)?.toLowerCase();
  if (raw === 'true' || raw === 'yes' || raw === 'si' || raw === 'sì')
    return true;
  if (raw === 'false' || raw === 'no') return false;
  return null;
}

function int(value: string | number | boolean | null | undefined) {
  const n = typeof value === 'number' ? value : Number(text(value));
  return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
}

/** What only some ID documents print, from their template fields. */
export function readDetails(
  f: Fields,
  expiryDate: string | null,
): IdDocumentDetailsDto {
  const format = text(f['card_format'])?.toLowerCase();
  return {
    heightCm: int(f['height_cm']),
    cardFormat: format === 'electronic' || format === 'paper' ? format : null,
    cardAccessNumber: text(f['card_access_number'])?.replace(/\s/g, '') ?? null,
    validForTravel: bool(f['valid_for_travel']),
    passportType: text(f['passport_type']),
    eyeColor: text(f['eye_color']),
    healthCardKind: text(f['card_kind']),
    institutionCode: text(f['institution_code']),
    licenceCategories: licenceCategories(f, expiryDate),
    restrictionCodes: [
      ...new Set(
        (text(f['restriction_codes']) ?? '')
          .split(/[\s,;]+/)
          .map((c) => c.trim())
          .filter((c) => /^\d{2,3}(\.\d{2})?/.test(c)),
      ),
    ].map((code) => ({ code, meaning: restrictionMeaning(code) })),
  };
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
  const expiryDate = dateOf(f[ID_DOCUMENT_FIELD_KEYS.expiryDate]);
  return {
    holder,
    documentNumber:
      text(f[ID_DOCUMENT_FIELD_KEYS.documentNumber])?.replace(/\s/g, '') ??
      null,
    issuer: text(f[ID_DOCUMENT_FIELD_KEYS.issuer]),
    issuingCountry: text(f[ID_DOCUMENT_FIELD_KEYS.issuingCountry]),
    issueDate: dateOf(f[ID_DOCUMENT_FIELD_KEYS.issueDate]),
    expiryDate,
    details: readDetails(f, expiryDate),
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
  /** A driving licence's categories, each with its own expiry. */
  categories?: readonly LicenceCategoryDto[];
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
 * A licence category with its own, earlier expiry date warns by itself.
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
  /** Days before expiry the warning starts, per type (Settings → Reminders). */
  windows: Readonly<Record<IdDocumentType, number>> = EXPIRY_WARNING_DAYS,
): ExpiryAlertDto[] {
  const alerts: ExpiryAlertDto[] = [];
  for (const { type, versions } of series) {
    const latest = versions[0];
    if (!latest || !['current', 'expired'].includes(latest.status)) continue;
    const window = type ? windows[type] : 90;
    const warn = (expiryDate: string, category: string | null) => {
      const daysLeft = daysUntil(expiryDate, today);
      if (daysLeft > window) return;
      alerts.push({
        level: daysLeft < 0 ? 'expired' : 'expiring',
        personId: person.id,
        personName: [person.firstName, person.lastName]
          .filter(Boolean)
          .join(' '),
        uploadId: latest.document.uploadId,
        type,
        category,
        expiryDate,
        daysLeft,
      });
    };
    const expiryDate = latest.document.expiryDate;
    if (expiryDate) warn(expiryDate, null);
    // A licence category (C, D...) that expires before the licence warns by itself.
    for (const c of latest.document.categories ?? [])
      if (c.expiryDate && (!expiryDate || c.expiryDate < expiryDate))
        warn(c.expiryDate, c.category);
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

/** Whole years from `birthDate` to `today` (both YYYY-MM-DD). */
export function ageOn(birthDate: string | null, today: string): number | null {
  if (!birthDate || !/^\d{4}-\d{2}-\d{2}/.test(birthDate)) return null;
  let age = Number(today.slice(0, 4)) - Number(birthDate.slice(0, 4));
  if (today.slice(5, 10) < birthDate.slice(5, 10)) age--;
  return age >= 0 ? age : null;
}

/** The latest driving licence, as the Cars area shows it next to a driver. */
export function licenceSummary(
  series: readonly {
    type: IdDocumentType | null;
    versions: Version<ApprovedDocument>[];
  }[],
  today: string,
  windows: Readonly<Record<IdDocumentType, number>> = EXPIRY_WARNING_DAYS,
): PersonLicenceDto | null {
  const latest = series.find((s) => s.type === 'DRIVING_LICENCE')?.versions[0];
  if (!latest) return null;
  const { expiryDate, categories } = latest.document;
  const daysLeft = expiryDate ? daysUntil(expiryDate, today) : null;
  const status: PersonLicenceDto['status'] = !['current', 'expired'].includes(
    latest.status,
  )
    ? 'unusable'
    : daysLeft !== null && daysLeft < 0
      ? 'expired'
      : daysLeft !== null && daysLeft <= windows.DRIVING_LICENCE
        ? 'expiring'
        : 'valid';
  return {
    status,
    expiryDate,
    daysLeft,
    categories: (categories ?? [])
      .filter((c) => !c.expiryDate || c.expiryDate >= today)
      .map((c) => c.category),
  };
}

export interface NoticeDocument extends ApprovedDocument {
  validForTravel: boolean | null;
}

/**
 * What is worth knowing about a person, from their age and their documents:
 * an identity card not valid for travel, a minor's rules, an 18th birthday
 * coming, a missing health card.
 */
export function personNotices(
  person: { birthDate: string | null },
  series: readonly {
    type: IdDocumentType | null;
    versions: Version<NoticeDocument>[];
  }[],
  today: string,
): PersonNoticeDto[] {
  const notices: PersonNoticeDto[] = [];
  const latest = (type: IdDocumentType) => {
    const v = series.find((s) => s.type === type)?.versions[0];
    return v && ['current', 'expired'].includes(v.status) ? v : null;
  };
  const card = latest('IDENTITY_CARD');
  const passport = latest('PASSPORT');
  if (card?.status === 'current' && card.document.validForTravel === false)
    notices.push({
      level: 'warning',
      text:
        passport?.status === 'current'
          ? 'The identity card is not valid for travel abroad: take the passport when leaving Italy.'
          : 'The identity card is not valid for travel abroad, and there is no valid passport: neither can be used to leave Italy.',
    });
  if (!latest('HEALTH_CARD') && series.length)
    notices.push({
      level: 'info',
      text: 'No current health card on file: it carries the tax code and the European health card (TEAM) on its back.',
    });

  const age = ageOn(person.birthDate, today);
  if (age !== null && age < 18 && person.birthDate) {
    notices.push({
      level: 'info',
      text:
        age < 3
          ? "Under 3: a new identity card or passport lasts 3 years, and needs both parents' consent."
          : "Under 18: a new identity card or passport lasts 5 years, and needs both parents' consent.",
    });
    if (age < 14)
      notices.push({
        level: 'info',
        text: "Under 14: travelling abroad without a parent needs the dichiarazione di accompagnamento from the Questura, or the parents' names on the passport.",
      });
    const eighteenth = `${Number(person.birthDate.slice(0, 4)) + 18}${person.birthDate.slice(4, 10)}`;
    const days = daysUntil(eighteenth, today);
    if (days <= 180)
      notices.push({
        level: 'info',
        text: `Turns 18 in ${days} ${days === 1 ? 'day' : 'days'}: from then on a new identity card or passport lasts 10 years.`,
      });
  }
  return notices;
}
