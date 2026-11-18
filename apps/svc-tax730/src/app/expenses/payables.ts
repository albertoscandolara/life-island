import {
  isoAddDays,
  type DossierExpenseDto,
  type PayableDto,
  type PayablesQuery,
} from '@life-island/contracts';

/*
 * The 730's expenses as Money matching reads them (`GET /payables`,
 * docs/guides/money-matching.md): what was spent, with whom, and the days a
 * bank movement can be its payment. A match makes the expense traceable;
 * the payment proof document is still asked for.
 */

/** A deposit can be paid well before the invoice… */
export const PAID_BEFORE_DAYS = 30;
/** …and an invoice paid some time after it (a transfer, a payment plan). */
export const PAID_AFTER_DAYS = 90;

const KEY_PREFIX = 'taxes:expense:';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** An expense's key in Money matching (PayableDto.key). */
export function expensePayableKey(id: string): string {
  return `${KEY_PREFIX}${id}`;
}

/** The expense a payable key names, or null when it is not one of ours. */
export function expenseIdOfPayable(key: string): string | null {
  if (!key.startsWith(KEY_PREFIX)) return null;
  const id = key.slice(KEY_PREFIX.length);
  return UUID.test(id) ? id : null;
}

/**
 * One payable per counted expense (an expense paired into another is paid
 * through that one), whose window touches the days asked.
 */
export function expensePayables(
  expenses: readonly DossierExpenseDto[],
  query: PayablesQuery,
): PayableDto[] {
  return expenses.flatMap((e): PayableDto[] => {
    if (!(e.amount > 0)) return [];
    const window = {
      from: isoAddDays(e.date, -PAID_BEFORE_DAYS),
      to: isoAddDays(e.date, PAID_AFTER_DAYS),
    };
    if (window.from > query.to || window.to < query.from) return [];
    return [
      {
        key: expensePayableKey(e.id),
        module: 'taxes',
        kind: 'expense',
        title: `${e.issuer}${e.documentNumber ? `, invoice no. ${e.documentNumber}` : `, ${e.description ?? 'expense'}`}`,
        payees: [e.issuer].filter((name) => name.trim().length > 0),
        amount: Math.round(e.amount * 100) / 100,
        direction: 'out',
        date: e.date,
        window,
        path: '/taxes/730',
      },
    ];
  });
}
