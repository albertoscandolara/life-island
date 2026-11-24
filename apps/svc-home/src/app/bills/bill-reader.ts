import {
  entityKey,
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
  /** Street and number, when known: a document's address finds its house by it. */
  address?: string | null;
}

/** A bill as its document reads, before it is tied to its supplier, supply point and contract. */
export type ReadBill = Omit<
  BillDto,
  | 'id'
  | 'invoiceNumber'
  | 'totalDue'
  | 'supplierId'
  | 'supplierName'
  | 'supplyPointId'
  | 'contractId'
  | 'directDebit'
  | 'autoPaid'
  | 'bankPayment'
>;

/**
 * An internet bill by its own categories when no INTERNET_BILL is among
 * them: a category of yours (or one the AI proposed) whose id says so,
 * "TELECOM_BILL", "FIBRA", "ADSL". A mobile phone bill is not one.
 */
const INTERNET_CATEGORY =
  /(^|_)(INTERNET|FIBRA|FIBER|FIBRE|ADSL|VDSL|FTTH|FTTC|FWA|BROADBAND|TELECOM|TLC|WIFI|LANDLINE|TELEFONIA_FISSA|LINEA_FISSA)(_|$)/;
const NOT_INTERNET_CATEGORY = /(^|_)(MOBILE|MOBILI|CELLULARE|SIM)(_|$)/;
/** Fields only an internet bill prints. */
const INTERNET_FIELDS =
  /^(line_number|numero_linea|migration_code|codice_migrazione|subscription_fee|subscription_period)$/;

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
  if (!all.has('BILL')) return null;
  const metered = UTILITY_KINDS.find((kind) => {
    const field = UTILITIES[kind].consumptionField;
    return field !== null && toNumber(fields?.[field]) !== null;
  });
  if (metered) return metered;
  // A bill with no meter: internet, by its categories or the fields it prints.
  const ids = [...all];
  if (
    ids.some((id) => INTERNET_CATEGORY.test(id)) &&
    !ids.some((id) => NOT_INTERNET_CATEGORY.test(id))
  )
    return 'INTERNET';
  return Object.keys(fields ?? {}).some((key) => INTERNET_FIELDS.test(key))
    ? 'INTERNET'
    : null;
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

/**
 * The days an internet bill's fee pays for: its subscription period
 * ("Periodo abbonamento"), billed a month ahead of the traffic in its
 * billing period. Null when it prints none.
 */
export function subscriptionPeriod(
  fields: Fields,
): { start: string; end: string } | null {
  const period = fields['subscription_period'];
  if (typeof period === 'string') {
    const [start, end] = period.split('/').map((part) => asDate(part.trim()));
    if (start && end)
      return start <= end ? { start, end } : { start: end, end: start };
  }
  const start = asDate(fields['subscription_period_start']);
  const end = asDate(fields['subscription_period_end']);
  return start && end && start <= end ? { start, end } : null;
}

/** The recurring fee printed apart from the extras (internet), else null. */
export function feeOf(fields: Fields): number | null {
  for (const key of ['subscription_fee', 'monthly_fee', 'canone']) {
    const value = toNumber(fields[key]);
    if (value !== null) return Math.round(value * 100) / 100;
  }
  return null;
}

function amountOf(fields: Fields): number | null {
  const total = toNumber(fields['total_amount']);
  if (total !== null) return total;
  for (const [key, value] of Object.entries(fields)) {
    if (!/amount|total|importo/.test(key) || /taxable|imponibile/.test(key))
      continue;
    const number = toNumber(value);
    if (number !== null) return number;
  }
  return null;
}

function consumptionOf(fields: Fields, utility: UtilityKind): number | null {
  const field = UTILITIES[utility].consumptionField;
  // Nothing is metered on an internet line: a "consumo" there is minutes or GB.
  if (field === null) return null;
  const own = toNumber(fields[field]);
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
      /customer|pod|pdr|supply|cliente|utenza|contract|line_number|migration/.test(
        key,
      ),
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
 * gas, water or internet, when you excluded it, or when it has no amount to count.
 */
export function readBill(
  document: DocumentLike,
  properties: readonly PropertyLike[],
  parentOf: ParentOf,
  override: OverrideLike | null,
): ReadBill | null {
  if (override?.excluded) return null;
  const fields = document.fields ?? {};
  const detected = utilityOf(document.categories, fields, parentOf);
  const overridden = UTILITY_KINDS.find((kind) => kind === override?.utility);
  const utility = overridden ?? detected;
  if (!utility) return null;
  const amount = amountOf(fields);
  if (amount === null) return null;

  // An internet bill counts in the month its fee pays for, a month ahead
  // of the traffic it bills.
  const period =
    (utility === 'INTERNET' ? subscriptionPeriod(fields) : null) ??
    billingPeriod(fields);
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
    fee: feeOf(fields),
  };
}

/** The days a bill covers, for range filters: its period, else its issue or due date. */
export function billSpan(bill: {
  periodStart: string | null;
  periodEnd: string | null;
  issueDate: string | null;
  dueDate: string | null;
}): { start: string; end: string } | null {
  if (bill.periodStart && bill.periodEnd)
    return { start: bill.periodStart, end: bill.periodEnd };
  const day = bill.issueDate ?? bill.dueDate;
  return day ? { start: day, end: day } : null;
}

/** What a bill says about the entities around it: supplier, supply point, contract. */
export interface BillFacts {
  invoiceNumber: string | null;
  totalDue: number | null;
  supplierName: string | null;
  /** Codice fiscale or VAT number of the supplier, normalised (no `IT`, no spaces). */
  supplierTaxCode: string | null;
  /**
   * Every code the bill prints for its supplier, the tax code first: a big
   * company's codice fiscale is often not its VAT number (Wind Tre S.p.A.
   * prints both), and either one finds it.
   */
  supplierCodes: string[];
  /** POD, PDR, water supply code or internet line, normalised. */
  supplyPointCode: string | null;
  customerCode: string | null;
  distributorName: string | null;
  offerName: string | null;
  /** The day the offer started, when printed ("Internet 200 dal 18/06/2020"). */
  offerStart: string | null;
  /** Paid by direct debit (true), another way (false), or not printed (null). */
  directDebit: boolean | null;
}

/** Keys of the field that says how a bill is paid. */
const PAYMENT_KEY = /payment|pagamento/;
/**
 * How Italian bills print a direct debit: "Domiciliazione bancaria",
 * "Addebito diretto SEPA (SDD)", "Addebito su conto corrente", the old "RID".
 * Read on normalised text (lower case, no accents, single spaces).
 */
const DIRECT_DEBIT =
  /domicili|addebito (diretto|automatico|(in|su) (c|conto))|\bsdd\b|\bsepa\b|\brid\b|direct debit/;

/**
 * Whether a bill is paid by direct debit, from the field that says how it is
 * paid (`payment_method`, `metodo_pagamento`…): null when it prints none.
 */
export function readDirectDebit(fields: Fields): boolean | null {
  let other = false;
  for (const [key, value] of Object.entries(fields)) {
    if (!PAYMENT_KEY.test(key) || /date|due|status|amount/.test(key)) continue;
    const text = asText(value);
    if (!text) continue;
    if (DIRECT_DEBIT.test(normalizeText(text))) return true;
    other = true;
  }
  return other ? false : null;
}

const POD = /^IT\d{3}E[0-9A-Z]{5,}$/;
const PDR = /^\d{14}$/;

/** `IT 01234567890` → `01234567890`: a company's VAT number and tax code are the same digits. */
export const normalizeTaxCode = (code: string): string => {
  const plain = normalizeCode(code);
  return /^IT\d{11}$/.test(plain) ? plain.slice(2) : plain;
};

/**
 * A company name without case, accents or legal form, and without what
 * follows the legal form: "ACME S.p.A." = "Acme spa" = "acme", and
 * "EDILRENSO SNC DI RENSO MASSIMO E C." = "Edilrenso". The same key every
 * area reads names with (`entityKey`).
 */
export const organizationKey = (name: string): string =>
  entityKey(name) || normalizeText(name);

/**
 * A company's name as one word, to tell its documents together: "Wind Tre
 * S.p.A.", "WINDTRE" and "Wind Tre S.p.A. con Socio Unico" are one company.
 */
export const companyKey = (name: string): string =>
  organizationKey(name).replace(/\s+/g, '');

/** Every key a company is found by: its name and the other names documents print. */
export function organizationKeys(org: {
  name: string;
  nameKey: string;
  aliases: readonly string[];
}): string[] {
  return [
    ...new Set([
      organizationKey(org.name),
      org.nameKey,
      ...org.aliases.map(organizationKey),
    ]),
  ];
}

/**
 * The supply point of an internet bill: its line. The number of the line
 * first (it stays when you change provider and keep it), else the
 * migration code, else what the template calls the supply point.
 */
function internetLine(fields: Fields): string | null {
  const line = firstOf(
    fields,
    ['line_number', 'numero_linea', 'phone_number', 'supply_point_code'],
    asText,
  );
  const migration = firstOf(
    fields,
    ['migration_code', 'codice_migrazione'],
    asText,
  );
  const code = line ?? migration;
  return code ? normalizeCode(code) : null;
}

/**
 * The entity facts of a bill. The supply point code is the POD (electricity)
 * or PDR (gas) when printed; older templates kept it in `customer_id`, which
 * counts when it has a POD or PDR shape, and always for water, whose bills
 * have one code for the supply. An internet bill's supply point is its line.
 */
export function readBillFacts(fields: Fields, utility: UtilityKind): BillFacts {
  const legacy = asText(fields['customer_id']);
  const legacyCode = legacy ? normalizeCode(legacy) : null;
  const legacyIsPoint =
    legacyCode !== null &&
    utility !== 'INTERNET' &&
    (utility === 'WATER' ||
      (utility === 'ELECTRICITY' ? POD : PDR).test(legacyCode));
  const printed = firstOf(
    fields,
    ['supply_point_code', 'pod', 'pdr', 'pod_code', 'pdr_code'],
    asText,
  );
  const supplierCodes = [
    ...new Set(
      [
        'supplier_tax_code',
        'supplier_vat_number',
        'provider_tax_code',
        'provider_vat_number',
      ]
        .map((key) => asText(fields[key]))
        .filter((code): code is string => !!code)
        .map(normalizeTaxCode)
        .filter(Boolean),
    ),
  ];
  const total = toNumber(fields['total_due'] ?? fields['amount_due']);
  return {
    invoiceNumber: firstOf(
      fields,
      ['invoice_number', 'bill_number', 'document_number', 'numero_fattura'],
      asText,
    ),
    totalDue: total === null ? null : Math.round(total * 100) / 100,
    supplierName: firstOf(
      fields,
      ['provider', 'issuer', 'supplier', 'merchant_name'],
      asText,
    ),
    supplierTaxCode: supplierCodes[0] ?? null,
    supplierCodes,
    supplyPointCode:
      utility === 'INTERNET'
        ? internetLine(fields)
        : printed
          ? normalizeCode(printed)
          : legacyIsPoint
            ? legacyCode
            : null,
    customerCode:
      firstOf(fields, ['customer_code', 'codice_cliente'], asText) ??
      (legacyIsPoint ? null : legacy),
    distributorName: firstOf(
      fields,
      ['distributor', 'distributor_name'],
      asText,
    ),
    offerName: firstOf(fields, ['offer_name', 'offer'], asText),
    offerStart: firstOf(
      fields,
      ['offer_start_date', 'offer_start', 'activation_date'],
      asDate,
    ),
    directDebit: readDirectDebit(fields),
  };
}
