import {
  isoAddDays,
  type BillDto,
  type PayableDto,
  type PayablesQuery,
  type UtilityKind,
} from '@life-island/contracts';
import { billPayableKey } from './bills.service.js';

/*
 * The bills as Money matching reads them (`GET /payables`,
 * docs/guides/money-matching.md): what is due, to whom, and the days a bank
 * movement can be its payment.
 */

const UTILITY_WORDS: Record<UtilityKind, string> = {
  ELECTRICITY: 'electricity',
  GAS: 'gas',
  WATER: 'water',
  INTERNET: 'internet',
};

/** A bill can be paid a few days before it is issued (a prepaid amount)… */
export const PAID_BEFORE_ISSUE_DAYS = 3;
/** …or well after it is due (a late payment, a slow direct debit). */
export const PAID_AFTER_DUE_DAYS = 45;
/** Without an issue date, how far before the due date to look. */
const DUE_LOOKBACK_DAYS = 40;

export interface SupplierNames {
  name: string;
  aliases: string[];
}

/** One payable per counted bill with an amount and a date, whose window touches the query. */
export function billPayables(
  bills: readonly BillDto[],
  suppliers: ReadonlyMap<string, SupplierNames>,
  query: PayablesQuery,
): PayableDto[] {
  return bills.flatMap((bill): PayableDto[] => {
    const amount = bill.totalDue ?? bill.amount;
    const date = bill.dueDate ?? bill.issueDate;
    // A credit note or a bill with nothing left to pay is not a payment.
    if (!date || !(amount > 0)) return [];
    const window = {
      from: bill.issueDate
        ? isoAddDays(bill.issueDate, -PAID_BEFORE_ISSUE_DAYS)
        : isoAddDays(date, -DUE_LOOKBACK_DAYS),
      to: isoAddDays(date, PAID_AFTER_DUE_DAYS),
    };
    if (window.from > query.to || window.to < query.from) return [];
    const supplier = bill.supplierId ? suppliers.get(bill.supplierId) : null;
    const payees = [
      ...new Set(
        [bill.provider, supplier?.name, ...(supplier?.aliases ?? [])]
          .map((name) => name?.trim())
          .filter((name): name is string => !!name),
      ),
    ];
    const who = supplier?.name ?? bill.provider ?? 'Unknown supplier';
    return [
      {
        key: billPayableKey(bill.uploadId),
        module: 'home',
        kind: 'bill',
        title: `${who}, ${UTILITY_WORDS[bill.utility]} bill${bill.invoiceNumber ? ` no. ${bill.invoiceNumber}` : ''}`,
        payees,
        amount: Math.round(amount * 100) / 100,
        direction: 'out',
        date,
        window,
        autoPay: bill.autoPaid,
        path: '/home/bills',
      },
    ];
  });
}
