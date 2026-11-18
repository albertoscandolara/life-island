import {
  FINE_PAY_DAYS,
  isoAddDays,
  type CarCostDto,
  type CarFineDto,
  type PayableDto,
  type PayablesQuery,
} from '@life-island/contracts';

/*
 * Cars as Money matching reads them (`GET /payables`,
 * docs/guides/money-matching.md): every priced cost of a car (insurance,
 * road tax, inspection, fuel, service, repairs…) and every fine. A fine is
 * proposed at its reduced amount, with a tolerance up to the full one, so
 * paying within 5 days and paying within 60 both find it.
 */

/** A cost can be paid a little before its document's date (a deposit)… */
export const COST_PAID_BEFORE_DAYS = 10;
/** …or some weeks after it (an invoice paid by transfer). */
export const COST_PAID_AFTER_DAYS = 45;
/** A fine is paid after it reaches you; without that day, the law's longest notice (90 days). */
export const FINE_NOTICE_DAYS = 90;
/** Days after the last day to pay a fine that a late payment is still looked for. */
export const FINE_LATE_DAYS = 60;

const COST = 'cars:cost:';
const FINE = 'cars:fine:';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const round = (n: number) => Math.round(n * 100) / 100;

export const costPayableKey = (uploadId: string) => `${COST}${uploadId}`;
export const finePayableKey = (uploadId: string) => `${FINE}${uploadId}`;

/** The document a payable key of Cars names, or null when it is not one. */
export function uploadIdOfPayable(key: string): string | null {
  const id = key.startsWith(COST)
    ? key.slice(COST.length)
    : key.startsWith(FINE)
      ? key.slice(FINE.length)
      : null;
  return id && UUID.test(id) ? id.toLowerCase() : null;
}

const overlaps = (window: PayableDto['window'], query: PayablesQuery) =>
  window.from <= query.to && window.to >= query.from;

/** One payable per priced cost with a day, fines left out (they are below). */
export function costPayables(
  car: string,
  costs: readonly CarCostDto[],
  query: PayablesQuery,
): PayableDto[] {
  return costs.flatMap((cost): PayableDto[] => {
    if (cost.kind === 'fine' || !cost.date || !(cost.amount > 0)) return [];
    const window = {
      from: isoAddDays(cost.date, -COST_PAID_BEFORE_DAYS),
      to: isoAddDays(cost.date, COST_PAID_AFTER_DAYS),
    };
    if (!overlaps(window, query)) return [];
    return [
      {
        key: costPayableKey(cost.uploadId),
        module: 'cars',
        kind: 'cost',
        title: `${car}: ${cost.title}`,
        payees: cost.supplier?.trim() ? [cost.supplier.trim()] : [],
        amount: round(cost.amount),
        direction: 'out',
        date: cost.date,
        window,
        path: '/cars',
      },
    ];
  });
}

/**
 * One payable per fine with an amount: the reduced amount (within 5 days),
 * with a tolerance up to the full one, from the violation to two months
 * after the last day to pay.
 */
export function finePayables(
  car: string,
  fines: readonly CarFineDto[],
  query: PayablesQuery,
): PayableDto[] {
  return fines.flatMap((fine): PayableDto[] => {
    const full = fine.amount;
    const start = fine.violationDate ?? fine.notifiedOn;
    if (!full || !(full > 0) || !start) return [];
    const reduced =
      fine.reducedAmount && fine.reducedAmount > 0 && fine.reducedAmount < full
        ? fine.reducedAmount
        : full;
    const payBy =
      fine.payBy ?? isoAddDays(start, FINE_NOTICE_DAYS + FINE_PAY_DAYS);
    const window = {
      from: start,
      to: isoAddDays(payBy, FINE_LATE_DAYS),
    };
    if (!overlaps(window, query)) return [];
    // At most 0.5 (PayableDto): the reduced amount is 70% of the full one.
    const tolerance = Math.min(
      0.5,
      Math.ceil((full / reduced - 1) * 1000) / 1000,
    );
    return [
      {
        key: finePayableKey(fine.uploadId),
        module: 'cars',
        kind: 'fine',
        title: `${car}: fine${fine.number ? ` no. ${fine.number}` : ''}${fine.violationDate ? ` of ${fine.violationDate}` : ''}`,
        payees: fine.authority?.trim() ? [fine.authority.trim()] : [],
        amount: round(reduced),
        direction: 'out',
        date: fine.discountUntil ?? fine.payBy ?? start,
        window,
        ...(tolerance > 0 ? { tolerance } : {}),
        path: '/cars',
      },
    ];
  });
}
