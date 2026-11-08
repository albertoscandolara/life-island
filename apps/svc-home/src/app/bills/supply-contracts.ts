import type {
  BillAssignment,
  SupplyContractDto,
  UtilityKind,
} from '@life-island/contracts';
import type { Fields } from './bill-reader.js';

/*
 * Supply points and supply contracts, as Italian bills print them.
 *
 * The POD (electricity) and PDR (gas) name the meter: they belong to the
 * house and outlive every contract. The customer code (codice cliente) is
 * given by the supplier to one contract: a new supplier, a subentro after the
 * meter was closed, or a voltura to another holder each start a new contract
 * with a new code; an offer change with the same supplier keeps it.
 */

const normalize = (code: string): string =>
  code.replace(/[\s\-./]/g, '').toUpperCase();

/** POD: IT, the distributor's 3 digits, E, then the point's own code (IT001E36435004). */
export const isPod = (code: string): boolean =>
  /^IT\d{3}E[0-9A-Z]{7,9}$/.test(normalize(code));

/** PDR: 14 digits (01680102015791). */
export const isPdr = (code: string): boolean =>
  /^\d{14}$/.test(normalize(code));

/** A code that names a supply point (a meter), not a contract. */
export const isSupplyPointCode = (code: string): boolean =>
  isPod(code) || isPdr(code);

const asText = (value: unknown): string | null =>
  typeof value === 'string' && value.trim()
    ? value.trim().replace(/\s+/g, ' ')
    : typeof value === 'number' && Number.isFinite(value)
      ? String(value)
      : null;

const SUPPLY_POINT_KEYS = [
  'pod',
  'pdr',
  'supply_point_code',
  'pod_code',
  'pdr_code',
];
const CUSTOMER_CODE_KEYS = [
  'customer_code',
  'codice_cliente',
  'customer_number',
  'client_code',
];
const OFFER_KEYS = ['offer_name', 'offer', 'tariff_name', 'tariff', 'offerta'];

export interface BillCodes {
  /** POD or PDR, without spaces, upper case. */
  supplyPoint: string | null;
  /** Codice cliente, as printed (spaces removed). */
  customerCode: string | null;
  offer: string | null;
}

/**
 * The codes a bill prints. Older bills were read into one `customer_id`
 * field holding either code: a POD or PDR there is the supply point,
 * anything else is the customer code.
 */
export function readBillCodes(fields: Fields): BillCodes {
  let supplyPoint: string | null = null;
  let customerCode: string | null = null;
  for (const key of SUPPLY_POINT_KEYS) {
    const value = asText(fields[key]);
    if (value) {
      supplyPoint = normalize(value);
      break;
    }
  }
  for (const key of CUSTOMER_CODE_KEYS) {
    const value = asText(fields[key]);
    if (value) {
      customerCode = value.replace(/\s+/g, '');
      break;
    }
  }
  const shared = asText(fields['customer_id']);
  if (shared) {
    if (isSupplyPointCode(shared)) supplyPoint ??= normalize(shared);
    else customerCode ??= shared.replace(/\s+/g, '');
  }
  // A "customer code" that is really a POD or PDR names the meter.
  if (customerCode && isSupplyPointCode(customerCode)) {
    supplyPoint ??= normalize(customerCode);
    customerCode = null;
  }
  let offer: string | null = null;
  for (const key of OFFER_KEYS) {
    offer = asText(fields[key]);
    if (offer) break;
  }
  return { supplyPoint, customerCode, offer };
}

/** "Magis Energia S.p.A." → "magis energia": legal forms and case ignored. */
export function supplierKey(supplier: string | null): string {
  return (supplier ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\b(s p a|spa|s r l|srl|s n c|snc|s a s|sas)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** The contract a bill belongs to, or null when it prints no customer code. */
export function contractKey(
  utility: UtilityKind,
  supplier: string | null,
  customerCode: string | null,
): string | null {
  if (!customerCode) return null;
  return `${utility}:${supplierKey(supplier)}:${normalize(customerCode)}`;
}

/** What a bill tells about its contract. */
export interface ContractBill {
  utility: UtilityKind;
  provider: string | null;
  customerCode: string | null;
  supplyPointCode: string | null;
  offer: string | null;
  propertyId: string | null;
  assignment: BillAssignment | null;
  /** True when you put it on a house, or took it off every house, yourself. */
  manual?: boolean;
  periodStart: string | null;
  periodEnd: string | null;
  issueDate: string | null;
  uploadedAt?: string;
}

/**
 * A bill with no house follows the other bills of its contract: the same
 * supplier and customer code means the same supply, so the same house. Only
 * when they all agree on one house; your own choices are never changed.
 */
export function assignBySupplyContract<T extends ContractBill>(
  bills: T[],
): T[] {
  const housesOf = new Map<string, Set<string>>();
  for (const bill of bills) {
    const key = contractKey(bill.utility, bill.provider, bill.customerCode);
    if (!key || !bill.propertyId) continue;
    const houses = housesOf.get(key) ?? new Set<string>();
    houses.add(bill.propertyId);
    housesOf.set(key, houses);
  }
  return bills.map((bill) => {
    if (bill.propertyId || bill.manual) return bill;
    const key = contractKey(bill.utility, bill.provider, bill.customerCode);
    const houses = key ? housesOf.get(key) : undefined;
    if (!houses || houses.size !== 1) return bill;
    return {
      ...bill,
      propertyId: [...houses][0],
      assignment: 'SUPPLY_CONTRACT' as const,
    };
  });
}

const firstDay = (b: ContractBill) =>
  b.periodStart ?? b.issueDate ?? b.uploadedAt?.slice(0, 10) ?? null;
const lastDay = (b: ContractBill) =>
  b.periodEnd ?? b.issueDate ?? b.uploadedAt?.slice(0, 10) ?? null;
const min = (a: string | null, b: string | null) =>
  a === null ? b : b === null ? a : a < b ? a : b;
const max = (a: string | null, b: string | null) =>
  a === null ? b : b === null ? a : a > b ? a : b;

/**
 * The supply contracts the bills show, one per utility, supplier and
 * customer code, each valid from its first billed day to its last. On a
 * house, the contract of a utility billed last is ACTIVE; the earlier ones
 * were REPLACED (a new supplier, a subentro or a voltura).
 */
export function supplyContracts(
  bills: readonly ContractBill[],
): SupplyContractDto[] {
  const byKey = new Map<string, ContractBill[]>();
  for (const bill of bills) {
    const key = contractKey(bill.utility, bill.provider, bill.customerCode);
    if (!key) continue;
    byKey.set(key, [...(byKey.get(key) ?? []), bill]);
  }
  const contracts: SupplyContractDto[] = [...byKey.entries()].map(
    ([key, group]) => {
      const sorted = [...group].sort((a, b) =>
        (lastDay(a) ?? '').localeCompare(lastDay(b) ?? ''),
      );
      const newest = sorted[sorted.length - 1];
      const houses = new Map<string, number>();
      for (const b of group)
        if (b.propertyId)
          houses.set(b.propertyId, (houses.get(b.propertyId) ?? 0) + 1);
      // The house most of its bills are on (the newest bill breaks a tie).
      const propertyId =
        [...houses.entries()].sort(
          (a, b) =>
            b[1] - a[1] ||
            Number(b[0] === newest.propertyId) -
              Number(a[0] === newest.propertyId),
        )[0]?.[0] ?? null;
      const offers: SupplyContractDto['offers'] = [];
      for (const b of sorted) {
        if (!b.offer) continue;
        const last = offers[offers.length - 1];
        if (last && supplierKey(last.name) === supplierKey(b.offer))
          last.to = max(last.to, lastDay(b));
        else offers.push({ name: b.offer, from: firstDay(b), to: lastDay(b) });
      }
      return {
        key,
        utility: newest.utility,
        supplier:
          [...sorted].reverse().find((b) => b.provider)?.provider ?? null,
        customerCode: newest.customerCode!,
        supplyPointCode:
          [...sorted].reverse().find((b) => b.supplyPointCode)
            ?.supplyPointCode ?? null,
        propertyId,
        from: group.reduce<string | null>((d, b) => min(d, firstDay(b)), null),
        to: group.reduce<string | null>((d, b) => max(d, lastDay(b)), null),
        status: 'ACTIVE' as const,
        offers,
        billCount: group.length,
      };
    },
  );
  // On each house and utility, only the contract billed last is still running.
  const latest = new Map<string, SupplyContractDto>();
  for (const c of contracts) {
    if (!c.propertyId) continue;
    const slot = `${c.propertyId}:${c.utility}`;
    const current = latest.get(slot);
    if (!current || (c.to ?? '') > (current.to ?? '')) latest.set(slot, c);
  }
  for (const c of contracts)
    if (c.propertyId && latest.get(`${c.propertyId}:${c.utility}`) !== c)
      c.status = 'REPLACED';
  return contracts.sort(
    (a, b) =>
      a.utility.localeCompare(b.utility) ||
      (b.to ?? '').localeCompare(a.to ?? ''),
  );
}
