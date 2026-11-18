import type {
  HouseInsuranceDto,
  HouseInternetDto,
  HouseServiceDocumentDto,
  HouseServiceDocumentRole,
  HouseServicesDto,
} from '@life-island/contracts';
import {
  billingPeriod,
  normalizeCode,
  normalizeText,
  organizationKey,
  toNumber,
  utilityOf,
  withAncestors,
  type DocumentLike,
  type OverrideLike,
  type PropertyLike,
} from '../bills/bill-reader.js';
import { documentHouse } from './house-reader.js';

/** What a house service document is about. */
export type HouseServiceKind = 'INTERNET' | 'INSURANCE';

type Fields = NonNullable<DocumentLike['fields']>;

/** The category hierarchy with titles: categories are yours, so they are read by their words. */
export type CategoryInfo = ReadonlyMap<
  string,
  { title: string; parentId: string | null }
>;

export interface ServiceDocumentLike extends DocumentLike {
  uploadedAt: Date | string;
}

const INTERNET_WORDS =
  /\b(internet|fibra|fiber|fibre|adsl|vdsl|ftth|fttc|fwa|broadband|banda larga|wi ?fi|telefonia fissa|linea fissa|landline|connettivita|connectivity|telecomunicazioni|telecom|tlc|modem|router)\b/;
const INTERNET_FIELDS =
  /^(migration_code|codice_migrazione|line_number|numero_linea|bandwidth|download_speed|velocita)$/;
const INSURANCE_WORDS =
  /\b(insurance|insurances|assicurazione|assicurazioni|assicurativ[aeoi]|polizza|polizze|policy|quietanza)\b/;
/** Insurances that are not about a house. */
const NOT_HOUSE_INSURANCE =
  /\b(car|cars|auto|automobile|vehicle|vehicles|veicolo|veicoli|rca|moto|motorcycle|health|salute|sanitari[ao]|medical|vita|life|travel|viaggio|viaggi|pet|animali|infortuni|accident)\b/;
/** Words that make an insurance a home one even with no house matched yet. */
const HOUSE_INSURANCE =
  /\b(casa|home|house|abitazione|incendio|fire|furto|theft|fabbricato|building|multirischi[ao]?|household|famiglia|family|capofamiglia|catastrofal[ei]|scoppio|danni)\b/;
const BILL_WORDS =
  /\b(bill|bills|bolletta|bollette|fattura|fatture|invoice|invoices|quietanza|receipt|ricevuta)\b/;

/** The words of a document's categories and their ancestors, ids and titles. */
function categoryWords(
  document: DocumentLike,
  categories: CategoryInfo,
): string {
  const parentOf = new Map(
    [...categories.entries()].map(([id, c]) => [id, c.parentId]),
  );
  const ids = new Set(
    document.categories.flatMap((id) => withAncestors(id, parentOf)),
  );
  return ` ${normalizeText(
    [...ids]
      .flatMap((id) => [id.replace(/_/g, ' '), categories.get(id)?.title ?? ''])
      .join(' '),
  )} `;
}

/**
 * Whether a document is about a house's internet line or insurance, by its
 * categories (yours, read by their words) and the fields it prints. A bill
 * of electricity, gas or water is a bill of Bills, never one of these; an
 * internet bill is both a bill of Bills and what the Internet card reads.
 */
export function serviceKindOf(
  document: DocumentLike,
  categories: CategoryInfo,
): { kind: HouseServiceKind; sure: boolean } | null {
  const parentOf = new Map(
    [...categories.entries()].map(([id, c]) => [id, c.parentId]),
  );
  // A bill of electricity, gas or water is only a bill; an internet bill is
  // also what the house's Internet card reads its line from.
  const utility = utilityOf(document.categories, document.fields, parentOf);
  if (utility === 'INTERNET') return { kind: 'INTERNET', sure: true };
  if (utility) return null;
  const words = categoryWords(document, categories);
  const fields = document.fields ?? {};
  if (
    INTERNET_WORDS.test(words) ||
    Object.keys(fields).some((key) => INTERNET_FIELDS.test(key))
  )
    return { kind: 'INTERNET', sure: true };
  if (INSURANCE_WORDS.test(words) && !NOT_HOUSE_INSURANCE.test(words))
    return { kind: 'INSURANCE', sure: HOUSE_INSURANCE.test(words) };
  return null;
}

const text = (value: unknown): string | null =>
  typeof value === 'string' && value.trim()
    ? value.trim().replace(/\s+/g, ' ')
    : typeof value === 'number' && Number.isFinite(value)
      ? String(value)
      : null;

const day = (value: unknown): string | null =>
  typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value)
    ? value.slice(0, 10)
    : null;

function first<T>(
  fields: Fields,
  keys: readonly string[],
  read: (value: unknown) => T | null,
): T | null {
  for (const key of keys) {
    const value = read(fields[key]);
    if (value !== null) return value;
  }
  return null;
}

const PROVIDER_KEYS = [
  'provider',
  'operator',
  'issuer',
  'supplier',
  'merchant_name',
  'company',
  'company_name',
];
const INSURER_KEYS = [
  'insurer',
  'insurance_company',
  'compagnia',
  'compagnia_assicurativa',
  ...PROVIDER_KEYS,
];
const AMOUNT_KEYS = [
  'total_amount',
  'amount',
  'total',
  'importo',
  'amount_due',
  'total_due',
];

/** What one document says about a house service. */
export interface ServiceReading {
  kind: HouseServiceKind;
  uploadId: string;
  title: string;
  role: HouseServiceDocumentRole;
  date: string;
  propertyId: string | null;
  manual: boolean;
  provider: string | null;
  customerCode: string | null;
  lineNumber: string | null;
  offerName: string | null;
  monthlyFee: number | null;
  policyNumber: string | null;
  coverage: string | null;
  startDate: string | null;
  endDate: string | null;
  premium: number | null;
  amount: number | null;
  /** Days its amount covers, for a bill with a period. */
  periodDays: number | null;
}

/**
 * Reads an internet or insurance document, or null when it is neither (or
 * you excluded it). An insurance whose categories do not say "home" counts
 * only once it is matched to a house.
 */
export function readService(
  document: ServiceDocumentLike,
  categories: CategoryInfo,
  properties: readonly PropertyLike[],
  override: OverrideLike | null,
): ServiceReading | null {
  if (override?.excluded) return null;
  const found = serviceKindOf(document, categories);
  if (!found) return null;
  const parentOf = new Map(
    [...categories.entries()].map(([id, c]) => [id, c.parentId]),
  );
  const manual = override?.manualProperty ?? false;
  const propertyId = manual
    ? (override?.propertyId ?? null)
    : documentHouse(document, properties, parentOf, null);
  if (found.kind === 'INSURANCE' && !found.sure && !propertyId && !manual)
    return null;

  const fields: Fields = document.fields ?? {};
  const words = categoryWords(document, categories);
  const period = billingPeriod(fields);
  const role: HouseServiceDocumentRole =
    BILL_WORDS.test(words) || period ? 'BILL' : 'CONTRACT';
  const uploadedAt =
    typeof document.uploadedAt === 'string'
      ? document.uploadedAt
      : document.uploadedAt.toISOString();
  const startDate =
    first(
      fields,
      [
        'start_date',
        'coverage_start',
        'policy_start',
        'effective_date',
        'contract_start',
        'activation_date',
        'decorrenza',
      ],
      day,
    ) ?? null;
  const endDate =
    first(
      fields,
      [
        'end_date',
        'coverage_end',
        'policy_end',
        'expiry_date',
        'expiration_date',
        'renewal_date',
        'scadenza',
      ],
      day,
    ) ?? null;
  const date =
    period?.end ??
    first(
      fields,
      ['issue_date', 'document_date', 'invoice_date', 'date'],
      day,
    ) ??
    startDate ??
    uploadedAt.slice(0, 10);
  const periodDays = period
    ? Math.round(
        (Date.parse(period.end) - Date.parse(period.start)) / 86_400_000,
      ) + 1
    : null;

  return {
    kind: found.kind,
    uploadId: document.uploadId,
    title: document.title,
    role,
    date,
    propertyId,
    manual,
    provider: first(
      fields,
      found.kind === 'INSURANCE' ? INSURER_KEYS : PROVIDER_KEYS,
      text,
    ),
    customerCode: first(
      fields,
      [
        'customer_code',
        'codice_cliente',
        'customer_id',
        'account_number',
        'contract_number',
      ],
      text,
    ),
    lineNumber: first(
      fields,
      ['line_number', 'phone_number', 'numero_linea', 'telefono'],
      text,
    ),
    offerName: first(
      fields,
      ['offer_name', 'offer', 'plan', 'plan_name', 'tariff', 'piano'],
      text,
    ),
    monthlyFee: first(
      fields,
      ['monthly_fee', 'monthly_cost', 'monthly_price', 'canone_mensile'],
      toNumber,
    ),
    policyNumber: first(
      fields,
      ['policy_number', 'numero_polizza', 'policy_id', 'contract_number'],
      text,
    ),
    coverage: first(
      fields,
      [
        'coverage',
        'coverages',
        'insurance_type',
        'policy_type',
        'guarantees',
        'garanzie',
        'product',
        'product_name',
      ],
      text,
    ),
    startDate,
    endDate,
    premium: first(
      fields,
      ['annual_premium', 'yearly_premium', 'premium', 'premio', 'premio_annuo'],
      toNumber,
    ),
    amount: first(fields, AMOUNT_KEYS, toNumber),
    periodDays,
  };
}

const round = (n: number) => Math.round(n * 100) / 100;

function documentsOf(readings: ServiceReading[]): HouseServiceDocumentDto[] {
  return readings
    .map((r) => ({
      uploadId: r.uploadId,
      title: r.title,
      role: r.role,
      date: r.date,
      amount: r.amount,
      manual: r.manual,
    }))
    .sort((a, b) => b.date.localeCompare(a.date));
}

const newestFirst = (a: ServiceReading, b: ServiceReading) =>
  b.date.localeCompare(a.date);

function groupBy(
  readings: readonly ServiceReading[],
  key: (r: ServiceReading) => string,
): Map<string, ServiceReading[]> {
  const groups = new Map<string, ServiceReading[]>();
  for (const r of readings) {
    const k = key(r);
    groups.set(k, [...(groups.get(k) ?? []), r]);
  }
  for (const list of groups.values()) list.sort(newestFirst);
  return groups;
}

const pick = <T>(
  list: ServiceReading[],
  read: (r: ServiceReading) => T | null,
) => list.map(read).find((v): v is T => v !== null) ?? null;

/**
 * The internet lines and insurances of your houses, from what each document
 * says: one line per house and provider (the one billed last is the active
 * one), one insurance per house, insurer and policy number.
 */
export function houseServices(
  readings: readonly ServiceReading[],
  today: string,
): HouseServicesDto {
  const yearAgo = new Date(Date.parse(today) - 365 * 86_400_000)
    .toISOString()
    .slice(0, 10);

  const internet: HouseInternetDto[] = [];
  const lines = groupBy(
    readings.filter((r) => r.kind === 'INTERNET'),
    (r) =>
      `${r.propertyId ?? ''}|${r.provider ? organizationKey(r.provider) : ''}`,
  );
  for (const [key, list] of lines) {
    const bills = list.filter((r) => r.role === 'BILL' && r.amount !== null);
    const lastBill = bills[0] ?? null;
    const perMonth =
      lastBill?.periodDays && lastBill.amount !== null
        ? round((lastBill.amount / lastBill.periodDays) * 30.44)
        : null;
    const days = list.map((r) => r.date).sort();
    internet.push({
      key,
      propertyId: list[0].propertyId,
      provider: pick(list, (r) => r.provider),
      offerName: pick(list, (r) => r.offerName),
      customerCode: pick(list, (r) => r.customerCode),
      lineNumber: pick(list, (r) => r.lineNumber),
      monthlyCost: pick(list, (r) => r.monthlyFee) ?? perMonth,
      firstDay: days[0],
      lastDay: days[days.length - 1],
      status: 'ACTIVE',
      lastBill: lastBill
        ? { date: lastBill.date, amount: lastBill.amount as number }
        : null,
      yearCost: round(
        bills
          .filter((b) => b.date > yearAgo && b.date <= today)
          .reduce((sum, b) => sum + (b.amount ?? 0), 0),
      ),
      documents: documentsOf(list),
    });
  }
  // On each house the line billed last is the one you have; the others ended.
  const latest = new Map<string, string>();
  for (const line of internet) {
    if (!line.propertyId) continue;
    const best = latest.get(line.propertyId);
    const other = internet.find((l) => l.key === best);
    if (!other || line.lastDay > other.lastDay)
      latest.set(line.propertyId, line.key);
  }
  for (const line of internet)
    if (line.propertyId && latest.get(line.propertyId) !== line.key)
      line.status = 'ENDED';

  const insurances: HouseInsuranceDto[] = [];
  const policies = groupBy(
    readings.filter((r) => r.kind === 'INSURANCE'),
    (r) =>
      [
        r.propertyId ?? '',
        r.provider ? organizationKey(r.provider) : '',
        r.policyNumber ? normalizeCode(r.policyNumber) : '',
      ].join('|'),
  );
  for (const [key, list] of policies) {
    const starts = list
      .map((r) => r.startDate)
      .filter((d): d is string => !!d)
      .sort();
    const ends = list
      .map((r) => r.endDate)
      .filter((d): d is string => !!d)
      .sort();
    const endDate = ends.at(-1) ?? null;
    insurances.push({
      key,
      propertyId: list[0].propertyId,
      insurer: pick(list, (r) => r.provider),
      policyNumber: pick(list, (r) => r.policyNumber),
      coverage: pick(list, (r) => r.coverage),
      startDate: starts[0] ?? null,
      endDate,
      premium: pick(list, (r) => r.premium) ?? pick(list, (r) => r.amount),
      status: endDate ? (endDate >= today ? 'ACTIVE' : 'EXPIRED') : 'UNKNOWN',
      documents: documentsOf(list),
    });
  }

  const statusRank = { ACTIVE: 0, UNKNOWN: 1, ENDED: 2, EXPIRED: 2 } as const;
  return {
    internet: internet.sort(
      (a, b) =>
        statusRank[a.status] - statusRank[b.status] ||
        b.lastDay.localeCompare(a.lastDay),
    ),
    insurances: insurances.sort(
      (a, b) =>
        statusRank[a.status] - statusRank[b.status] ||
        (b.endDate ?? '').localeCompare(a.endDate ?? ''),
    ),
  };
}
