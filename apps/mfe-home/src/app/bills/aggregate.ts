import type { BillDto, UtilityKind } from '@life-island/contracts';

/** How bills are bucketed along time. */
export type Grain = 'month' | 'quarter' | 'year';

/**
 * Which months a bill counts in. `period`: spread over the days it covers
 * (a Jan–Feb bill is half January, half February), so seasons line up.
 * `date`: all of it in the month it was issued, like your bank account sees it.
 */
export type Basis = 'period' | 'date';

/** What is summed. */
export type Metric = 'amount' | 'consumption';

/** Months, inclusive, as `YYYY-MM`. */
export interface MonthRange {
  from: string;
  to: string;
}

export interface Share {
  month: string;
  /** The part of the bill that falls in this month, 0..1. */
  weight: number;
}

const DAY = 86_400_000;
const toTime = (iso: string) => Date.parse(`${iso}T00:00:00Z`);
const monthOf = (time: number) => new Date(time).toISOString().slice(0, 7);

export function addMonths(month: string, count: number): string {
  const [year, m] = month.split('-').map(Number);
  const index = year * 12 + (m - 1) + count;
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, '0')}`;
}

export function monthsBetween(range: MonthRange): string[] {
  const months: string[] = [];
  for (let m = range.from; m <= range.to; m = addMonths(m, 1)) months.push(m);
  return months;
}

/** The month a bill is dated in: its issue date, else the end of its period, else its due date. */
export function billMonth(bill: BillDto): string | null {
  const day = bill.issueDate ?? bill.periodEnd ?? bill.dueDate;
  return day ? day.slice(0, 7) : null;
}

/** How a bill splits over months on a basis; empty when it has no date at all. */
export function shares(bill: BillDto, basis: Basis): Share[] {
  if (basis === 'period' && bill.periodStart && bill.periodEnd) {
    const start = toTime(bill.periodStart);
    const end = toTime(bill.periodEnd) + DAY;
    const total = end - start;
    const result: Share[] = [];
    let cursor = start;
    while (cursor < end) {
      const month = monthOf(cursor);
      const next = Math.min(end, toTime(`${addMonths(month, 1)}-01`));
      result.push({ month, weight: (next - cursor) / total });
      cursor = next;
    }
    return result;
  }
  const month = billMonth(bill);
  return month ? [{ month, weight: 1 }] : [];
}

export function bucketOf(month: string, grain: Grain): string {
  if (grain === 'month') return month;
  const year = month.slice(0, 4);
  if (grain === 'year') return year;
  return `${year}-Q${Math.floor((Number(month.slice(5, 7)) - 1) / 3) + 1}`;
}

/** Every bucket from the range's first month to its last, in order. */
export function bucketsOf(range: MonthRange, grain: Grain): string[] {
  return [...new Set(monthsBetween(range).map((m) => bucketOf(m, grain)))];
}

export interface Series {
  id: string;
  values: number[];
}

export interface Aggregate {
  buckets: string[];
  series: Series[];
}

/**
 * Sums bills into time buckets, one series per key (`keyOf` returns null to
 * leave a bill out). Series come back in `keys` order, so colours never move.
 */
export function aggregate(
  bills: readonly BillDto[],
  options: {
    range: MonthRange;
    grain: Grain;
    basis: Basis;
    metric: Metric;
    keys: readonly string[];
    keyOf: (bill: BillDto) => string | null;
  },
): Aggregate {
  const buckets = bucketsOf(options.range, options.grain);
  const index = new Map(buckets.map((bucket, i) => [bucket, i]));
  const series = new Map(
    options.keys.map((key) => [key, buckets.map(() => 0)]),
  );
  for (const bill of bills) {
    const key = options.keyOf(bill);
    const values = key === null ? undefined : series.get(key);
    if (!values) continue;
    const value = options.metric === 'amount' ? bill.amount : bill.consumption;
    if (value === null) continue;
    for (const share of shares(bill, options.basis)) {
      if (share.month < options.range.from || share.month > options.range.to)
        continue;
      const i = index.get(bucketOf(share.month, options.grain));
      if (i !== undefined) values[i] += value * share.weight;
    }
  }
  return {
    buckets,
    series: options.keys.map((id) => ({
      id,
      values: (series.get(id) ?? []).map(round2),
    })),
  };
}

/** Total of a metric inside a range (shares outside it do not count). */
export function totalIn(
  bills: readonly BillDto[],
  range: MonthRange,
  basis: Basis,
  metric: Metric = 'amount',
): number {
  let total = 0;
  for (const bill of bills) {
    const value = metric === 'amount' ? bill.amount : bill.consumption;
    if (value === null) continue;
    for (const share of shares(bill, basis))
      if (share.month >= range.from && share.month <= range.to)
        total += value * share.weight;
  }
  return round2(total);
}

/** The same number of months right before a range. */
export function previousRange(range: MonthRange): MonthRange {
  const length = monthsBetween(range).length;
  return {
    from: addMonths(range.from, -length),
    to: addMonths(range.from, -1),
  };
}

/** The first and last month any bill touches; null with no dated bills. */
export function extent(
  bills: readonly BillDto[],
  basis: Basis,
): MonthRange | null {
  let from: string | null = null;
  let to: string | null = null;
  for (const bill of bills)
    for (const share of shares(bill, basis)) {
      if (!from || share.month < from) from = share.month;
      if (!to || share.month > to) to = share.month;
    }
  return from && to ? { from, to } : null;
}

/**
 * One line per year, January to December: compare this winter's gas with the
 * last ones. Years come oldest first; a month with no bills is null.
 */
export function yearOverYear(
  bills: readonly BillDto[],
  basis: Basis,
  metric: Metric,
  years: readonly number[],
): { year: number; values: (number | null)[] }[] {
  return years.map((year) => {
    const values: (number | null)[] = Array(12).fill(null);
    for (const bill of bills) {
      const value = metric === 'amount' ? bill.amount : bill.consumption;
      if (value === null) continue;
      for (const share of shares(bill, basis)) {
        if (Number(share.month.slice(0, 4)) !== year) continue;
        const m = Number(share.month.slice(5, 7)) - 1;
        values[m] = (values[m] ?? 0) + value * share.weight;
      }
    }
    return { year, values: values.map((v) => (v === null ? null : round2(v))) };
  });
}

export interface UtilityStats {
  utility: UtilityKind;
  amount: number;
  consumption: number;
  /** Bills with a consumption: the cost per unit is only computed on these. */
  unitCost: number | null;
  bills: number;
}

/** Totals per utility inside a range, with the average cost per unit (€/kWh, €/Smc, €/m³). */
export function utilityStats(
  bills: readonly BillDto[],
  range: MonthRange,
  basis: Basis,
  utilities: readonly UtilityKind[],
): UtilityStats[] {
  return utilities.map((utility) => {
    const own = bills.filter((b) => b.utility === utility);
    const metered = own.filter(
      (b) => b.consumption !== null && b.consumption > 0,
    );
    const meteredAmount = totalIn(metered, range, basis, 'amount');
    const consumption = totalIn(metered, range, basis, 'consumption');
    return {
      utility,
      amount: totalIn(own, range, basis, 'amount'),
      consumption,
      unitCost: consumption > 0 ? round4(meteredAmount / consumption) : null,
      bills: own.filter((b) =>
        shares(b, basis).some(
          (s) => s.month >= range.from && s.month <= range.to,
        ),
      ).length,
    };
  });
}

export type GroupBy = 'period' | 'utility' | 'property' | 'provider';

export interface GroupRow {
  key: string;
  amount: number;
  consumption: Partial<Record<UtilityKind, number>>;
  bills: number;
}

/**
 * The table under the charts: totals grouped by period, utility, property or
 * provider, inside the range. A bill counts once per group it touches.
 */
export function groupRows(
  bills: readonly BillDto[],
  options: {
    range: MonthRange;
    basis: Basis;
    grain: Grain;
    by: GroupBy;
    labelOfProperty: (id: string | null) => string;
  },
): GroupRow[] {
  const rows = new Map<string, GroupRow & { seen: Set<string> }>();
  for (const bill of bills)
    for (const share of shares(bill, options.basis)) {
      if (share.month < options.range.from || share.month > options.range.to)
        continue;
      const key =
        options.by === 'period'
          ? bucketOf(share.month, options.grain)
          : options.by === 'utility'
            ? bill.utility
            : options.by === 'property'
              ? options.labelOfProperty(bill.propertyId)
              : (bill.provider ?? 'Unknown provider');
      let row = rows.get(key);
      if (!row) {
        row = { key, amount: 0, consumption: {}, bills: 0, seen: new Set() };
        rows.set(key, row);
      }
      row.amount += bill.amount * share.weight;
      if (bill.consumption !== null)
        row.consumption[bill.utility] =
          (row.consumption[bill.utility] ?? 0) +
          bill.consumption * share.weight;
      if (!row.seen.has(bill.uploadId)) {
        row.seen.add(bill.uploadId);
        row.bills++;
      }
    }
  const result = [...rows.values()].map(({ seen: _seen, ...row }) => ({
    ...row,
    amount: round2(row.amount),
    consumption: Object.fromEntries(
      Object.entries(row.consumption).map(([k, v]) => [k, round2(v)]),
    ),
  }));
  return options.by === 'period'
    ? result.sort((a, b) => b.key.localeCompare(a.key))
    : result.sort((a, b) => b.amount - a.amount);
}

const round2 = (value: number) => Math.round(value * 100) / 100;
const round4 = (value: number) => Math.round(value * 10_000) / 10_000;
