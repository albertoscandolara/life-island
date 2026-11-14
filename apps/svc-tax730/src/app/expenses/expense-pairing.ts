/**
 * Pairs the expenses that are one and the same: an invoice and the transfers
 * that paid it, or the "ricevuta" and the "dettaglio" of one bank transfer.
 * Each document you approve becomes an expense of its own, so without this an
 * invoice of 55.000 € paid in two transfers of 15.000 € and 40.000 €, each with
 * two bank receipts, counts 165.000 € instead of 55.000 €.
 *
 * Pairing is automatic and reviewable: what you confirm (`CONFIRMED`) or keep
 * apart (`SEPARATE`) is stored on the expense and always wins over the guess.
 */

export type ExpenseKind = 'INVOICE' | 'PAYMENT';
export type PairingDecision = 'CONFIRMED' | 'SEPARATE';

export interface PairableExpense {
  id: string;
  taxYear: number;
  date: string;
  amount: number;
  issuer: string;
  /** What the expense's document is called: its title, file name and number. */
  text: string;
  /**
   * What else is written about it (descriptions). It helps find the supplier,
   * but only says invoice or payment when the name does not: an invoice
   * often reads "to be paid by bank transfer".
   */
  details?: string;
  pairedWith: string | null;
  pairing: PairingDecision | null;
}

export interface Pairing {
  /** The expense that is counted: the invoice, or the first receipt of a transfer. */
  primaryId: string;
  /** False once you confirmed it. */
  automatic: boolean;
}

const DAY_MS = 24 * 60 * 60 * 1000;
/** Receipts of one transfer: the bank's and the supplier's may be a few days apart. */
const SAME_TRANSFER_DAYS = 3;
/** Transfers that pay an invoice: an advance before it, a balance after it. */
const PAYS_INVOICE_DAYS = 180;
/** Candidate transfers tried together against one invoice (2^n subsets). */
const MAX_CANDIDATES = 10;

/** Words that say what the document is or who moved the money, never who was paid. */
const NOT_A_PARTY = new Set([
  // legal forms and generic words of company names
  'srl',
  'srls',
  'spa',
  'snc',
  'sas',
  'societa',
  'impianti',
  'studio',
  'dott',
  'dottor',
  'della',
  'delle',
  'degli',
  // what the document is
  'fattura',
  'invoice',
  'ricevuta',
  'receipt',
  'dettaglio',
  'detail',
  'bonifico',
  'bonifici',
  'transfer',
  'pagamento',
  'payment',
  'agevolazione',
  'fiscale',
  'detrazione',
  'copia',
  'documento',
  // banks, which issue the receipts of every transfer
  'banca',
  'banco',
  'bank',
  'widiba',
  'intesa',
  'sanpaolo',
  'unicredit',
  'fineco',
  'poste',
  'postepay',
  'italiane',
  'mediolanum',
  'credem',
  'popolare',
  'credito',
  'cooperativo',
  'hype',
  'revolut',
  'paypal',
]);

const PAYMENT_WORDS =
  /bonific|wire transfer|bank transfer|pagament|payment|addebit|\bsepa\b|carta di credito|credit card/i;
const INVOICE_WORDS = /fattura|invoice|parcella|preventivo/i;
const BANK_ISSUER =
  /\bbanc[ao]\b|\bbank\b|widiba|intesa|unicredit|fineco|poste italiane|postepay|mediolanum|credem|paypal|revolut/i;

function normalize(text: string): string {
  return text.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

/**
 * The words that can name the other party: four letters or more, or a number
 * of four digits or more that is not a year (an invoice number like 000234).
 */
export function partyWords(text: string): Set<string> {
  return new Set(
    normalize(text)
      .split(/[^a-z0-9]+/)
      .filter(
        (word) =>
          word.length >= 4 &&
          !NOT_A_PARTY.has(word) &&
          !/^(19|20)\d\d$/.test(word) &&
          !/^\d+k$/.test(word),
      ),
  );
}

/** Whether the expense was read from a payment (a transfer receipt) rather than an invoice. */
export function expenseKind(
  expense: Pick<PairableExpense, 'issuer' | 'text' | 'details'>,
): ExpenseKind {
  const name = `${expense.issuer} ${expense.text}`;
  if (PAYMENT_WORDS.test(name)) return 'PAYMENT';
  if (INVOICE_WORDS.test(name)) return 'INVOICE';
  if (BANK_ISSUER.test(expense.issuer)) return 'PAYMENT';
  const details = expense.details ?? '';
  if (INVOICE_WORDS.test(details)) return 'INVOICE';
  return PAYMENT_WORDS.test(details) ? 'PAYMENT' : 'INVOICE';
}

const days = (a: string, b: string) =>
  Math.abs(Date.parse(a) - Date.parse(b)) / DAY_MS;

/** A transfer's tolerance against the invoice: bank fees, rounding. */
const tolerance = (amount: number) =>
  Math.max(0.01, Math.min(10, amount * 0.01));

function shareAWord(a: Set<string>, b: Set<string>): boolean {
  for (const word of a) if (b.has(word)) return true;
  return false;
}

interface Cluster {
  head: PairableExpense;
  members: PairableExpense[];
  amount: number;
  words: Set<string>;
}

/**
 * Which expenses are paired with another one, by id. An expense that is not
 * in the map is counted on its own. A primary is never paired itself.
 */
export function pairExpenses(
  expenses: readonly PairableExpense[],
): Map<string, Pairing> {
  const byId = new Map(expenses.map((e) => [e.id, e]));
  const result = new Map<string, Pairing>();

  // 1. What you confirmed, followed to the expense that is counted.
  const rootOf = (expense: PairableExpense): PairableExpense | null => {
    const seen = new Set<string>();
    let current = expense;
    while (current.pairing === 'CONFIRMED' && current.pairedWith) {
      if (seen.has(current.id)) return null;
      seen.add(current.id);
      const next = byId.get(current.pairedWith);
      if (!next) break;
      current = next;
    }
    return current;
  };
  for (const expense of expenses) {
    if (expense.pairing !== 'CONFIRMED' || !expense.pairedWith) continue;
    const root = rootOf(expense);
    if (root && root.id !== expense.id)
      result.set(expense.id, { primaryId: root.id, automatic: false });
  }
  const confirmedPrimaries = new Set(
    [...result.values()].map((pairing) => pairing.primaryId),
  );

  // Only an expense with no decision of yours is ever paired automatically.
  const free = expenses.filter((e) => !e.pairing && !result.has(e.id));
  const words = new Map(
    expenses.map((e) => [
      e.id,
      partyWords(
        `${BANK_ISSUER.test(e.issuer) ? '' : e.issuer} ${e.text} ${e.details ?? ''}`,
      ),
    ]),
  );
  const kinds = new Map(expenses.map((e) => [e.id, expenseKind(e)]));
  const byDate = (a: PairableExpense, b: PairableExpense) =>
    a.date.localeCompare(b.date) || a.id.localeCompare(b.id);

  // 2. The receipts of one transfer: same amount, same days, same supplier.
  const clusters: Cluster[] = [];
  const payments = expenses
    .filter((e) => kinds.get(e.id) === 'PAYMENT' && !result.has(e.id))
    .filter((e) => e.pairing !== 'SEPARATE')
    .sort(byDate);
  for (const payment of payments) {
    const ownWords = words.get(payment.id) ?? new Set<string>();
    const cluster =
      payment.pairing || confirmedPrimaries.has(payment.id)
        ? undefined
        : clusters.find(
            (c) =>
              c.head.taxYear === payment.taxYear &&
              Math.abs(c.amount - payment.amount) < 0.01 &&
              days(c.head.date, payment.date) <= SAME_TRANSFER_DAYS &&
              shareAWord(c.words, ownWords),
          );
    if (cluster) {
      cluster.members.push(payment);
      for (const word of ownWords) cluster.words.add(word);
    } else {
      clusters.push({
        head: payment,
        members: [],
        amount: payment.amount,
        words: new Set(ownWords),
      });
    }
  }
  // A transfer whose receipts you confirmed elsewhere, or that already counts
  // confirmed ones, stays where it is.
  const movable = (c: Cluster) =>
    !c.head.pairing && !confirmedPrimaries.has(c.head.id);

  // 3. Each invoice takes the transfers that add up to it.
  const used = new Set<Cluster>();
  const invoices = free
    .filter((e) => kinds.get(e.id) === 'INVOICE')
    .sort(byDate);
  for (const invoice of invoices) {
    const invoiceWords = words.get(invoice.id) ?? new Set<string>();
    const candidates = clusters
      .filter(
        (c) =>
          !used.has(c) &&
          movable(c) &&
          c.head.taxYear === invoice.taxYear &&
          days(c.head.date, invoice.date) <= PAYS_INVOICE_DAYS &&
          c.amount <= invoice.amount + tolerance(invoice.amount) &&
          shareAWord(c.words, invoiceWords),
      )
      .sort(
        (a, b) =>
          days(a.head.date, invoice.date) - days(b.head.date, invoice.date),
      )
      .slice(0, MAX_CANDIDATES);
    const best = bestSubset(candidates, invoice.amount);
    if (!best) continue;
    for (const cluster of best) {
      used.add(cluster);
      for (const payment of [cluster.head, ...cluster.members])
        result.set(payment.id, { primaryId: invoice.id, automatic: true });
    }
  }

  // 4. A transfer with no invoice counts once, through its first receipt.
  for (const cluster of clusters) {
    if (used.has(cluster)) continue;
    for (const member of cluster.members)
      result.set(member.id, { primaryId: cluster.head.id, automatic: true });
  }
  return result;
}

/** The transfers that add up to the invoice, fewest first; null when none do. */
function bestSubset(candidates: Cluster[], amount: number): Cluster[] | null {
  let best: { clusters: Cluster[]; gap: number } | null = null;
  const limit = tolerance(amount);
  for (let mask = 1; mask < 1 << candidates.length; mask++) {
    const clusters = candidates.filter((_, i) => mask & (1 << i));
    const gap = Math.abs(
      clusters.reduce((sum, c) => sum + c.amount, 0) - amount,
    );
    if (gap > limit) continue;
    if (
      !best ||
      clusters.length < best.clusters.length ||
      (clusters.length === best.clusters.length && gap < best.gap)
    )
      best = { clusters, gap };
  }
  return best?.clusters ?? null;
}
