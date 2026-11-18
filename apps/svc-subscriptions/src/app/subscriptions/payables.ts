import {
  BILLING_CYCLE_MONTHS,
  bankPaymentOf,
  isoAddDays,
  isoAddMonths,
  type PayableDto,
  type PayablesQuery,
  type PaymentRecord,
  type SubscriptionChargeDto,
  type SubscriptionDto,
} from '@life-island/contracts';

/*
 * Contracts as Money matching reads them (`GET /payables`,
 * docs/guides/money-matching.md): one payable per charge, every billing cycle
 * from the renewal day. A charge a little over the contract's cost (up to
 * CHARGE_TOLERANCE) is still proposed, as "check it", so a price rise is
 * caught and never linked on its own.
 */

/** A card or a direct debit is charged a few days before the renewal… */
export const CHARGED_BEFORE_DAYS = 5;
/** …or some days after it (the bank books it late, a retry). */
export const CHARGED_AFTER_DAYS = 10;
/** How much over its cost a charge may be and still be proposed. */
export const CHARGE_TOLERANCE = 0.1;

const KEY_PREFIX = 'subscriptions:charge:';
const KEY =
  /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.(\d{4}-\d{2}-\d{2})$/i;
const CENT = 0.005;

/** A charge's key in Money matching: `subscriptions:charge:<id>.<day>`. */
export function chargePayableKey(contractId: string, date: string): string {
  return `${KEY_PREFIX}${contractId}.${date}`;
}

/** The contract and day a payable key names, or null when it is not ours. */
export function chargeOfPayable(
  key: string,
): { contractId: string; date: string } | null {
  if (!key.startsWith(KEY_PREFIX)) return null;
  const match = KEY.exec(key.slice(KEY_PREFIX.length));
  return match ? { contractId: match[1].toLowerCase(), date: match[2] } : null;
}

export type ChargedContract = Pick<
  SubscriptionDto,
  | 'id'
  | 'name'
  | 'provider'
  | 'cost'
  | 'cycle'
  | 'startOn'
  | 'renewsOn'
  | 'autoRenew'
  | 'autoPay'
  | 'status'
  | 'priceChanges'
> & {
  /** The day it was last changed: a cancelled contract stops charging there. */
  changedOn: string;
};

/** What the contract cost on a day, from its price changes. */
export function costOn(
  contract: Pick<SubscriptionDto, 'cost' | 'priceChanges'>,
  date: string,
): number {
  let cost = contract.cost;
  // Walk back from today's cost through the changes made after that day.
  const later = contract.priceChanges
    .filter((change) => change.date > date)
    .sort((a, b) => b.date.localeCompare(a.date));
  for (const change of later) cost = change.from;
  return cost;
}

/**
 * The days a contract is charged between `from` and `to`, both included:
 * every billing cycle counted from the renewal day (or the start), never
 * before the start, never during a free trial, and never after the end of a
 * contract that does not renew or was cancelled.
 */
export function chargeDays(
  contract: ChargedContract,
  from: string,
  to: string,
): string[] {
  const anchor = contract.renewsOn ?? contract.startOn;
  if (!anchor || !(contract.cost > 0) || from > to) return [];
  const months = BILLING_CYCLE_MONTHS[contract.cycle];
  // The first cycle at or before `from`, counted in whole cycles.
  const [fy, fm] = from.split('-').map(Number);
  const [ay, am] = anchor.split('-').map(Number);
  let k = Math.floor((fy * 12 + fm - (ay * 12 + am)) / months) - 1;
  const days: string[] = [];
  for (let guard = 0; guard < 2000; guard++, k++) {
    const day = isoAddMonths(anchor, months * k);
    if (day > to) break;
    if (day < from) continue;
    if (contract.startOn && day < contract.startOn) continue;
    // A trial is free until it ends (its renewal day).
    if (
      contract.status === 'trial' &&
      contract.renewsOn &&
      day < contract.renewsOn
    )
      continue;
    // A contract that does not renew ends on its renewal day.
    if (!contract.autoRenew && contract.renewsOn && day >= contract.renewsOn)
      continue;
    if (contract.status === 'cancelled' && day > contract.changedOn) continue;
    days.push(day);
  }
  return days;
}

/** One payable per charge whose window touches the days asked. */
export function chargePayables(
  contracts: readonly ChargedContract[],
  query: PayablesQuery,
): PayableDto[] {
  return contracts.flatMap((contract) =>
    chargeDays(
      contract,
      isoAddDays(query.from, -CHARGED_AFTER_DAYS),
      isoAddDays(query.to, CHARGED_BEFORE_DAYS),
    ).map((day): PayableDto => ({
      key: chargePayableKey(contract.id, day),
      module: 'subscriptions',
      kind: 'charge',
      title: `${contract.name}, charge of ${day}`,
      payees: [
        ...new Set(
          [contract.provider, contract.name].flatMap((name) =>
            name && name.trim() ? [name.trim()] : [],
          ),
        ),
      ],
      amount: Math.round(costOn(contract, day) * 100) / 100,
      direction: 'out',
      date: day,
      window: {
        from: isoAddDays(day, -CHARGED_BEFORE_DAYS),
        to: isoAddDays(day, CHARGED_AFTER_DAYS),
      },
      tolerance: CHARGE_TOLERANCE,
      autoPay: contract.autoPay,
      path: '/subscriptions',
    })),
  );
}

/** A payment row with the key it pays (the `payments` table). */
export type ChargePayment = PaymentRecord & { payableKey: string };

/**
 * The latest charge of a contract that bank movements paid, with what it
 * should have cost that day; null when none is matched.
 */
export function lastCharge(
  contract: Pick<SubscriptionDto, 'id' | 'cost' | 'priceChanges'>,
  payments: readonly ChargePayment[],
): SubscriptionChargeDto | null {
  const byDay = new Map<string, ChargePayment[]>();
  for (const payment of payments) {
    const charge = chargeOfPayable(payment.payableKey);
    if (!charge || charge.contractId !== contract.id.toLowerCase()) continue;
    byDay.set(charge.date, [...(byDay.get(charge.date) ?? []), payment]);
  }
  for (const date of [...byDay.keys()].sort().reverse()) {
    const expected = costOn(contract, date);
    const paid = bankPaymentOf(expected, byDay.get(date)!);
    if (!paid) continue;
    const rise = Math.round((paid.paid - expected) * 100) / 100;
    return {
      date,
      paid: paid.paid,
      expected,
      paidOn: paid.lastDate,
      accounts: paid.accounts,
      priceRise: rise > CENT ? rise : null,
    };
  }
  return null;
}
