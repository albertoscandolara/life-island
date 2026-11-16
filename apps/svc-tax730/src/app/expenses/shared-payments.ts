/**
 * One payment document that proves several invoices: a single bank transfer of
 * 854 € that paid a fridge (550 €) and a washing machine (304 €) of the same
 * supplier. Each invoice stays an expense of its own, counted with its own
 * amount; the transfer is the payment proof of all of them.
 *
 * A transfer you filed with one invoice is offered automatically to the other
 * invoices it adds up with (same year, same supplier, close dates, no payment
 * proof yet); filing it with them yourself keeps it there.
 */
import { bestSubset, partyWords } from './expense-pairing.js';

const DAY_MS = 24 * 60 * 60 * 1000;
/** Invoices a transfer pays: an advance before it, a balance after it. */
const PAYS_INVOICE_DAYS = 180;
/** Other invoices tried together against one transfer (2^n subsets). */
const MAX_CANDIDATES = 10;

export interface SharableExpense {
  id: string;
  date: string;
  amount: number;
  issuer: string;
  /** What the expense is called: its description, document number. */
  text: string;
  /** Its payment proofs, by document. */
  paymentUploads: readonly string[];
}

export interface SharablePayment {
  /** The amount written on the transfer, when it was read. */
  amount: number | null;
  /** Its title, file name and fields, to find the supplier. */
  text: string;
}

export interface SharedPayment {
  uploadId: string;
  /** Every expense the transfer proves, the one you filed it with first. */
  expenseIds: string[];
  /** The expenses it was offered to automatically, not filed by you. */
  suggestedFor: string[];
}

const days = (a: string, b: string) =>
  Math.abs(Date.parse(a) - Date.parse(b)) / DAY_MS;

function shareAWord(a: Set<string>, b: Set<string>): boolean {
  for (const word of a) if (b.has(word)) return true;
  return false;
}

/**
 * The payment documents of one year that prove more than one expense: filed
 * with several by you, or adding up with other invoices of the same supplier.
 */
export function sharePayments(
  expenses: readonly SharableExpense[],
  paymentOf: (uploadId: string) => SharablePayment | undefined,
): SharedPayment[] {
  const filedWith = new Map<string, string[]>();
  for (const expense of expenses)
    for (const uploadId of new Set(expense.paymentUploads))
      filedWith.set(uploadId, [...(filedWith.get(uploadId) ?? []), expense.id]);

  const byId = new Map(expenses.map((e) => [e.id, e]));
  const proven = new Set(
    expenses.filter((e) => e.paymentUploads.length).map((e) => e.id),
  );
  const result: SharedPayment[] = [];
  // Oldest transfer first, so the same invoice is never offered two of them.
  const uploads = [...filedWith.entries()].sort(([, a], [, b]) =>
    (byId.get(a[0])?.date ?? '').localeCompare(byId.get(b[0])?.date ?? ''),
  );
  for (const [uploadId, ids] of uploads) {
    const payment = paymentOf(uploadId);
    const filed = ids
      .map((id) => byId.get(id))
      .filter((e): e is SharableExpense => !!e);
    const filedTotal = filed.reduce((sum, e) => sum + e.amount, 0);
    let suggested: SharableExpense[] = [];
    // The transfer is larger than what it is filed with: find the rest.
    if (payment?.amount && payment.amount - filedTotal > 0.5) {
      const words = partyWords(
        `${payment.text} ${filed.map((e) => `${e.issuer} ${e.text}`).join(' ')}`,
      );
      const first = filed[0];
      const candidates = expenses
        .filter(
          (e) =>
            !proven.has(e.id) &&
            e.amount < payment.amount! &&
            days(e.date, first.date) <= PAYS_INVOICE_DAYS &&
            shareAWord(words, partyWords(`${e.issuer} ${e.text}`)),
        )
        .sort((a, b) => days(a.date, first.date) - days(b.date, first.date))
        .slice(0, MAX_CANDIDATES);
      suggested = bestSubset(candidates, payment.amount - filedTotal) ?? [];
      for (const e of suggested) proven.add(e.id);
    }
    if (filed.length + suggested.length < 2) continue;
    result.push({
      uploadId,
      expenseIds: [...ids, ...suggested.map((e) => e.id)],
      suggestedFor: suggested.map((e) => e.id),
    });
  }
  return result;
}
