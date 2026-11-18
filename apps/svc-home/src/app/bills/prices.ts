import {
  billUnitPrice,
  priceUnitOf,
  UTILITIES,
  type BillPriceChangeDto,
  type UtilityKind,
} from '@life-island/contracts';

/*
 * What you pay for what you get, the same way for every bill: the price per
 * unit of a metered bill (€/kWh, €/Smc, €/m³: its amount over what it
 * billed, so it moves with the price, not with how much you used), and the
 * monthly fee of an internet bill. A price that goes up is a price rise or a
 * promo that ended: the house shows it, and Home's attention list asks you to
 * look around, because a supplier that changes the terms lets you leave
 * without penalties.
 */

export interface PriceBill {
  uploadId: string;
  contractId: string | null;
  utility: UtilityKind;
  amount: number;
  consumption: number | null;
  fee: number | null;
  periodStart: string | null;
  issueDate: string | null;
}

export interface ContractPrice {
  /** The price of its latest bill that has one. */
  price: number | null;
  /** The last change worth a look; null when the price held. */
  change: BillPriceChangeDto | null;
}

/** How long a rise stays in Home's attention list. */
export const PRICE_RISE_ATTENTION_DAYS = 60;
/**
 * A metered price moves a little with every bill (fixed charges over fewer
 * kWh, estimated readings): only a move this large against the same months
 * a year before (else the bills before) is a change. A flat fee changes when it changes, by any cent.
 */
export const METERED_CHANGE = 0.15;
/** Bills before the latest one that make its "before". */
const BASELINE_BILLS = 3;

const dayOf = (bill: Pick<PriceBill, 'periodStart' | 'issueDate'>) =>
  bill.periodStart ?? bill.issueDate ?? '';
const round = (value: number, digits: number) =>
  Math.round(value * 10 ** digits) / 10 ** digits;

/** The unit of a utility's price: "€/kWh", "€/month". */
export const priceUnit = priceUnitOf;

/** A bill's price (see billUnitPrice in libs/contracts). */
export const billPrice = (bill: PriceBill): number | null =>
  billUnitPrice(bill);

/** Days apart a bill may be from exactly a year before and still count as "a year ago". */
const YEAR_AGO_SLACK_DAYS = 45;

function sameTimeLastYear(
  own: readonly { bill: PriceBill; price: number }[],
  day: string,
): { bill: PriceBill; price: number } | null {
  const target = Date.parse(`${day}T00:00:00Z`) - 365 * 86_400_000;
  let best: { bill: PriceBill; price: number } | null = null;
  let bestGap = Infinity;
  for (const o of own) {
    const gap = Math.abs(Date.parse(`${dayOf(o.bill)}T00:00:00Z`) - target);
    if (gap <= YEAR_AGO_SLACK_DAYS * 86_400_000 && gap < bestGap) {
      best = o;
      bestGap = gap;
    }
  }
  return best;
}

const median = (values: number[]): number => {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

/**
 * Per contract, its current price and its last change. A flat fee: the last
 * time it differed from the bill before. A metered price: the latest bill
 * against the bill of the same months a year before (else the median of the
 * few before it), when it moved by at least METERED_CHANGE.
 */
export function contractPrices(
  bills: readonly PriceBill[],
): Map<string, ContractPrice> {
  const byContract = new Map<string, { bill: PriceBill; price: number }[]>();
  for (const bill of bills) {
    const price = billPrice(bill);
    if (!bill.contractId || price === null || !dayOf(bill)) continue;
    const own = byContract.get(bill.contractId) ?? [];
    own.push({ bill, price });
    byContract.set(bill.contractId, own);
  }
  const result = new Map<string, ContractPrice>();
  for (const [id, own] of byContract) {
    own.sort(
      (a, b) =>
        dayOf(a.bill).localeCompare(dayOf(b.bill)) ||
        a.bill.uploadId.localeCompare(b.bill.uploadId),
    );
    const last = own[own.length - 1];
    let change: BillPriceChangeDto | null = null;
    if (UTILITIES[last.bill.utility].metered) {
      // Fixed charges weigh more in a month you use little (gas in summer),
      // so the fair "before" is the same months a year earlier; without
      // one, the few bills before.
      const yearAgo = sameTimeLastYear(own, dayOf(last.bill));
      const before = yearAgo
        ? [yearAgo.price]
        : own.slice(-1 - BASELINE_BILLS, -1).map((o) => o.price);
      if (before.length) {
        const from = round(median(before), 4);
        if (Math.abs(last.price - from) / from >= METERED_CHANGE)
          change = {
            from,
            to: last.price,
            since: dayOf(last.bill),
            uploadId: last.bill.uploadId,
          };
      }
    } else
      for (let i = 1; i < own.length; i++)
        if (Math.abs(own[i].price - own[i - 1].price) >= 0.01)
          change = {
            from: own[i - 1].price,
            to: own[i].price,
            since: dayOf(own[i].bill),
            uploadId: own[i].bill.uploadId,
          };
    result.set(id, { price: last.price, change });
  }
  return result;
}
