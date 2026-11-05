import {
  UTILITIES,
  UTILITY_KINDS,
  type BillAssignment,
  type BillDto,
  type UtilityKind,
} from '@life-island/contracts';

export type Fields = Record<string, string | number | boolean | null>;

/** The category hierarchy as parent links, by category id. */
export type ParentOf = ReadonlyMap<string, string | null>;

export interface DocumentLike {
  uploadId: string;
  title: string;
  categories: string[];
  fields: Fields | null;
}

export interface PropertyLike {
  id: string;
  matchTerms: string[];
  supplyCodes: string[];
  categoryIds: string[];
}

export interface OverrideLike {
  manualProperty: boolean;
  propertyId: string | null;
  utility: string | null;
  excluded: boolean;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}/;
const UTILITY_BY_CATEGORY = new Map<string, UtilityKind>(
  UTILITY_KINDS.map((kind) => [UTILITIES[kind].categoryId, kind]),
);

/** A category and every ancestor of it, nearest first; safe against cycles. */
export function withAncestors(id: string, parentOf: ParentOf): string[] {
  const chain: string[] = [];
  let current: string | null | undefined = id;
  while (current && !chain.includes(current)) {
    chain.push(current);
    current = parentOf.get(current);
  }
  return chain;
}

/** Every category the document has, with their ancestors. */
export function expandCategories(
  categories: string[],
  parentOf: ParentOf,
): Set<string> {
  return new Set(categories.flatMap((id) => withAncestors(id, parentOf)));
}

/**
 * Which utility a document is a bill of: the first of its categories that is,
 * or sits under, ELECTRICITY_BILL, GAS_BILL or WATER_BILL. A plain BILL that
 * prints a consumption field of one utility counts as that utility.
 */
export function utilityOf(
  categories: string[],
  fields: Fields | null,
  parentOf: ParentOf,
): UtilityKind | null {
  for (const id of categories)
    for (const ancestor of withAncestors(id, parentOf)) {
      const kind = UTILITY_BY_CATEGORY.get(ancestor);
      if (kind) return kind;
    }
  const all = expandCategories(categories, parentOf);
  if (!all.has('BILL') || !fields) return null;
  return (
    UTILITY_KINDS.find(
      (kind) => toNumber(fields[UTILITIES[kind].consumptionField]) !== null,
    ) ?? null
  );
}

export function toNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string') return null;
  const text = value.trim().replace(/\s|€/g, '');
  // 1.234,56 (Italian) or 1,234.56 or 1234.56
  const normalized = /,\d{1,2}$/.test(text)
    ? text.replace(/\./g, '').replace(',', '.')
    : text.replace(/,/g, '');
  return /^-?\d+(\.\d+)?$/.test(normalized) ? Number(normalized) : null;
}

const asDate = (value: unknown): string | null =>
  typeof value === 'string' && ISO_DATE.test(value) ? value.slice(0, 10) : null;

const asText = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() ? value.trim() : null;

function firstOf<T>(
  fields: Fields,
  keys: string[],
  read: (value: unknown) => T | null,
): T | null {
  for (const key of keys) {
    const value = read(fields[key]);
    if (value !== null) return value;
  }
  return null;
}

/** `2026-01-01/2026-02-28`, or separate start and end fields. */
export function billingPeriod(
  fields: Fields,
): { start: string; end: string } | null {
  const period = fields['billing_period'] ?? fields['period'];
  if (typeof period === 'string') {
    const [start, end] = period.split('/').map((part) => asDate(part.trim()));
    if (start && end)
      return start <= end ? { start, end } : { start: end, end: start };
  }
  const start = firstOf(
    fields,
    ['period_start', 'billing_period_start', 'period_from'],
    asDate,
  );
  const end = firstOf(
    fields,
    ['period_end', 'billing_period_end', 'period_to'],
    asDate,
  );
  return start && end && start <= end ? { start, end } : null;
}

function amountOf(fields: Fields): number | null {
  const total = toNumber(fields['total_amount']);
  if (total !== null) return total;
  for (const [key, value] of Object.entries(fields)) {
    if (!/amount|total|importo/.test(key)) continue;
    const number = toNumber(value);
    if (number !== null) return number;
  }
  return null;
}

function consumptionOf(fields: Fields, utility: UtilityKind): number | null {
  const own = toNumber(fields[UTILITIES[utility].consumptionField]);
  if (own !== null) return own;
  for (const [key, value] of Object.entries(fields)) {
    if (!/consumption|consumo/.test(key)) continue;
    const number = toNumber(value);
    if (number !== null) return number;
  }
  return null;
}

/** Codes compared without spaces, dashes or case: `IT001 E 1234` = `it001e1234`. */
export const normalizeCode = (code: string): string =>
  code.replace(/[\s\-./]/g, '').toUpperCase();

/** Lower case, no accents, single spaces: "Via dei Bàndi " → "via dei bandi". */
export const normalizeText = (text: string): string =>
  text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

function codesOf(fields: Fields): string[] {
  return Object.entries(fields)
    .filter(([key]) =>
      /customer|pod|pdr|supply|cliente|utenza|contract/.test(key),
    )
    .map(([, value]) => asText(value))
    .filter((value): value is string => value !== null)
    .map(normalizeCode);
}

/** Where the energy or water is delivered: the home a bill is about. */
const SUPPLY_ADDRESS_KEY =
  /supply|fornitura|ubicazione|immobile|pod_address|pdr_address/;
/**
 * Where the bill is mailed, or who pays it: often a different home (you get
 * the bills of the house in Tregnago at your residence), so never evidence.
 */
const MAILING_ADDRESS_KEY =
  /billing|customer|cliente|recapito|mailing|intestatario|holder|sede|invio|residenza|residence/;
const ADDRESS_KEY = /address|indirizzo|location|ubicazione|fornitura/;

function addressText(document: DocumentLike, supplyOnly: boolean): string {
  const fields = document.fields ?? {};
  const parts = Object.entries(fields)
    .filter(([key]) =>
      supplyOnly
        ? SUPPLY_ADDRESS_KEY.test(key)
        : ADDRESS_KEY.test(key) &&
          (SUPPLY_ADDRESS_KEY.test(key) || !MAILING_ADDRESS_KEY.test(key)),
    )
    .map(([, value]) => asText(value))
    .filter((value): value is string => value !== null);
  return ` ${normalizeText((supplyOnly ? parts : [document.title, ...parts]).join(' '))} `;
}

/**
 * The property a bill belongs to, and why. Your manual choice wins; then the
 * strongest automatic evidence: a supply code (POD, PDR), then the supply
 * address, then a category of the property, then any other address or the
 * title. The mailing address of the account holder is never evidence: bills
 * of one home are often sent to another. Two properties with evidence of the
 * same strength leave the bill unassigned.
 */
export function matchProperty(
  document: DocumentLike,
  properties: readonly PropertyLike[],
  parentOf: ParentOf,
  override: OverrideLike | null,
): { propertyId: string | null; assignment: BillAssignment | null } {
  if (override?.manualProperty)
    return {
      propertyId: override.propertyId,
      assignment: override.propertyId ? 'MANUAL' : null,
    };

  const pick = (
    assignment: BillAssignment,
    test: (property: PropertyLike) => boolean,
  ) => {
    const hits = properties.filter(test);
    return hits.length === 1 ? { propertyId: hits[0].id, assignment } : null;
  };
  const mentions = (text: string) => (property: PropertyLike) =>
    property.matchTerms.some((term) => {
      const needle = normalizeText(term);
      return needle.length > 1 && text.includes(` ${needle} `);
    });

  const categories = expandCategories(document.categories, parentOf);
  const codes = new Set(codesOf(document.fields ?? {}));
  return (
    pick('SUPPLY_CODE', (p) =>
      p.supplyCodes.some((code) => codes.has(normalizeCode(code))),
    ) ??
    pick('ADDRESS', mentions(addressText(document, true))) ??
    pick('CATEGORY', (p) => p.categoryIds.some((id) => categories.has(id))) ??
    pick('ADDRESS', mentions(addressText(document, false))) ?? {
      propertyId: null,
      assignment: null,
    }
  );
}

/**
 * What Bills shows of a document: null when it is not a bill of electricity,
 * gas or water, when you excluded it, or when it has no amount to count.
 */
export function readBill(
  document: DocumentLike,
  properties: readonly PropertyLike[],
  parentOf: ParentOf,
  override: OverrideLike | null,
): BillDto | null {
  if (override?.excluded) return null;
  const fields = document.fields ?? {};
  const detected = utilityOf(document.categories, fields, parentOf);
  const overridden = UTILITY_KINDS.find((kind) => kind === override?.utility);
  const utility = overridden ?? detected;
  if (!utility) return null;
  const amount = amountOf(fields);
  if (amount === null) return null;

  const period = billingPeriod(fields);
  const issueDate = firstOf(
    fields,
    ['issue_date', 'document_date', 'invoice_date', 'date'],
    asDate,
  );
  const { propertyId, assignment } = matchProperty(
    document,
    properties,
    parentOf,
    override,
  );
  return {
    uploadId: document.uploadId,
    title: document.title,
    utility,
    utilityOverridden: !!overridden && overridden !== detected,
    propertyId,
    assignment,
    provider: firstOf(
      fields,
      ['provider', 'issuer', 'supplier', 'merchant_name'],
      asText,
    ),
    customerId: firstOf(fields, ['customer_id', 'pod', 'pdr'], asText),
    periodStart: period?.start ?? null,
    periodEnd: period?.end ?? null,
    issueDate,
    dueDate: firstOf(fields, ['due_date', 'payment_due_date'], asDate),
    amount: Math.round(amount * 100) / 100,
    currency: firstOf(fields, ['currency'], asText) ?? 'EUR',
    consumption: consumptionOf(fields, utility),
    unit: UTILITIES[utility].unit,
  };
}

/** The days a bill covers, for range filters: its period, else its issue or due date. */
export function billSpan(bill: BillDto): { start: string; end: string } | null {
  if (bill.periodStart && bill.periodEnd)
    return { start: bill.periodStart, end: bill.periodEnd };
  const day = bill.issueDate ?? bill.dueDate;
  return day ? { start: day, end: day } : null;
}
