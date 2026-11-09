import type {
  DocumentLinkStatus,
  TransactionFacts,
  TransactionParty,
} from '@life-island/contracts';

/**
 * The invoice and payment matcher: pure rules over the money facts the AI
 * read from each document's content (never the file name). It looks at every
 * invoice, quote and payment at once and returns the links that should exist,
 * so the result depends only on which documents there are and on your own
 * decisions, never on the order or the session they were uploaded in.
 *
 * What counts most: an explicit reference to the invoice in the payment, the
 * same supplier and beneficiary (IBAN, VAT number, tax code, name) and the
 * same amount. Descriptions, the customer and dates add to the evidence;
 * different dates never rule a match out. When the evidence is thin, or
 * several invoices could fit one payment, the link is only SUGGESTED, for you
 * to check.
 */

export interface MatchDocument {
  uploadId: string;
  facts: TransactionFacts;
}

/** Your own decision on a pair; the matcher never overrides it. */
export interface LinkDecision {
  invoiceUploadId: string;
  paymentUploadId: string;
  status: Extract<DocumentLinkStatus, 'CONFIRMED' | 'REJECTED'>;
}

export interface ProposedLink {
  invoiceUploadId: string;
  paymentUploadId: string;
  status: Extract<DocumentLinkStatus, 'AUTO' | 'SUGGESTED'>;
  score: number;
  reasons: string[];
}

export type PartyEvidence = 'iban' | 'id' | 'name' | 'weak-name' | null;
export type AmountEvidence =
  'exact' | 'close' | 'partial' | 'over' | 'mismatch' | null;
export type ReferenceEvidence = 'number' | 'date' | null;

export interface PairScore {
  score: number;
  reasons: string[];
  party: PartyEvidence;
  amount: AmountEvidence;
  reference: ReferenceEvidence;
  /** The payment says it is an advance, a balance, a part or an instalment. */
  partialKind: boolean;
  /** Words both descriptions share. */
  sharedWords: number;
}

/** Below this a pair is not even suggested. */
export const SUGGEST_MIN_SCORE = 5;
/** A pair links on its own only from this score, with strong evidence besides. */
export const AUTO_MIN_SCORE = 8;
/** How far ahead of the next candidate the best one must be to link on its own. */
export const AUTO_MARGIN = 3;
/** Most suggestions kept for one payment when nothing is clear. */
const MAX_SUGGESTIONS = 3;

const DAY_MS = 24 * 60 * 60 * 1000;

/** Words that say nothing about who or what: legal forms, titles, payment words. */
const GENERIC_WORDS = new Set(
  `srl srls spa snc sas sapa scarl scrl coop societa società cooperativa
   ltd llc inc gmbh company group gruppo
   dott dottor dottore dottssa dottoressa avv avvocato notaio studio associato associati ing geom rag arch sig sigra signor signora egr spett
   via viale piazza corso strada della delle degli dello dell del dei per con come una uno che the and for from with
   fattura fatture invoice invoices preventivo quote proforma nota documento document numero number
   pagamento payment pagato paid bonifico transfer sepa saldo acconto anticipo rata caparra
   totale total importo amount euro eur iva vat cod codice fiscale
   gennaio febbraio marzo aprile maggio giugno luglio agosto settembre ottobre novembre dicembre
   january february march april may june july august september october november december`
    .split(/\s+/)
    .filter(Boolean),
);

function words(text: string | null | undefined): Set<string> {
  if (!text) return new Set();
  return new Set(
    text
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .split(/[^a-z0-9]+/)
      .filter(
        (word) =>
          word.length >= 3 && !/^\d+$/.test(word) && !GENERIC_WORDS.has(word),
      ),
  );
}

/** Letters and digits only, upper case: `IT 44 J 0880...` and `IT44J0880...` agree. */
export function canonicalCode(value: string | null | undefined): string {
  return (value ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function vatOf(value: string | null | undefined): string {
  const code = canonicalCode(value);
  return /^IT\d{11}$/.test(code) ? code.slice(2) : code;
}

function idsOf(party: TransactionParty): Set<string> {
  return new Set(
    [vatOf(party.vatNumber), canonicalCode(party.taxCode)].filter(
      (id) => id.length >= 8,
    ),
  );
}

function ibanOf(party: TransactionParty): string {
  const iban = canonicalCode(party.iban);
  return iban.length >= 15 ? iban : '';
}

/** `strong` when the distinctive words of the shorter name are all in the other, or two are shared. */
export function compareNames(
  a: string | null | undefined,
  b: string | null | undefined,
): 'strong' | 'weak' | null {
  const left = words(a);
  const right = words(b);
  if (!left.size || !right.size) return null;
  const shared = [...left].filter((word) => right.has(word)).length;
  if (!shared) return null;
  return shared >= 2 || shared === Math.min(left.size, right.size)
    ? 'strong'
    : 'weak';
}

const MONEY = new Intl.NumberFormat('en-GB', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const DAY = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  timeZone: 'UTC',
});
const money = (value: number) => MONEY.format(value);
const day = (iso: string) => DAY.format(new Date(`${iso}T00:00:00Z`));

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/** How far apart two amounts may be and still count as the same: rounding or a bank fee. */
export function amountTolerance(total: number): number {
  return Math.min(5, Math.max(1, Math.abs(total) * 0.005));
}

const PARTIAL_KINDS = new Set(['ADVANCE', 'BALANCE', 'PARTIAL', 'INSTALLMENT']);

function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(to) - Date.parse(from)) / DAY_MS);
}

/** How strongly an invoice (or quote) and a payment belong together, with the reasons. */
export function scorePair(
  invoice: TransactionFacts,
  payment: TransactionFacts,
): PairScore {
  const reasons: string[] = [];
  let score = 0;

  // 1. The supplier is the beneficiary: IBAN, VAT number or tax code, name.
  let party: PartyEvidence = null;
  const invoiceIban = ibanOf(invoice.counterparty);
  const paymentIban = ibanOf(payment.counterparty);
  const invoiceIds = idsOf(invoice.counterparty);
  const paymentIds = idsOf(payment.counterparty);
  const sameId = [...paymentIds].some((id) => invoiceIds.has(id));
  if (invoiceIban && invoiceIban === paymentIban) {
    party = 'iban';
    score += 5;
    reasons.push(`Paid to the supplier's IBAN (${paymentIban})`);
  } else if (sameId) {
    party = 'id';
    score += 5;
    reasons.push('The beneficiary has the supplier’s VAT number or tax code');
  }
  const names = compareNames(
    invoice.counterparty.name,
    payment.counterparty.name,
  );
  if (names === 'strong') {
    party ??= 'name';
    score += 3;
    reasons.push(
      `Paid to ${payment.counterparty.name}, who issued the ${invoice.role === 'QUOTE' ? 'quote' : 'invoice'}`,
    );
  } else if (names === 'weak') {
    party ??= 'weak-name';
    score += 1;
    reasons.push(
      `The beneficiary’s name resembles the supplier’s (${payment.counterparty.name})`,
    );
  }
  if (!party || party === 'weak-name') {
    if (invoiceIban && paymentIban && invoiceIban !== paymentIban) {
      score -= 2;
      reasons.push('Paid to another IBAN than the supplier’s');
    }
    if (invoiceIds.size && paymentIds.size && !sameId) {
      score -= 3;
      reasons.push('The beneficiary has another VAT number or tax code');
    }
  }

  // 2. The customer is the payer.
  const sameCustomer =
    [...idsOf(payment.customer)].some((id) =>
      idsOf(invoice.customer).has(id),
    ) ||
    compareNames(invoice.customer.name, payment.customer.name) === 'strong';
  if (sameCustomer) {
    score += 1;
    reasons.push(
      `Paid by ${payment.customer.name ?? 'the invoice’s customer'}`,
    );
  }

  // 3. The amounts.
  let amount: AmountEvidence = null;
  const partialKind = PARTIAL_KINDS.has(payment.paymentKind ?? '');
  const currencies = [invoice.currency, payment.currency].map((c) =>
    canonicalCode(c),
  );
  if (currencies[0] && currencies[1] && currencies[0] !== currencies[1]) {
    amount = 'mismatch';
    score -= 4;
    reasons.push(`Different currency (${currencies[1]}, not ${currencies[0]})`);
  } else if (invoice.amount !== null && payment.amount !== null) {
    const total = invoice.amount;
    const paid = payment.amount;
    const fees = payment.fees ?? 0;
    const tolerance = amountTolerance(total);
    if (Math.abs(paid - total) < 0.005) {
      amount = 'exact';
      score += 5;
      reasons.push(`Same amount (${money(paid)})`);
    } else if (
      fees > 0 &&
      (Math.abs(paid + fees - total) < 0.005 ||
        Math.abs(paid - fees - total) < 0.005)
    ) {
      amount = 'close';
      score += 4;
      reasons.push(
        `Same amount once the bank fee of ${money(fees)} is counted (${money(paid)} for ${money(total)})`,
      );
    } else if (Math.abs(paid - total) <= tolerance) {
      amount = 'close';
      score += 3;
      reasons.push(
        `Nearly the same amount (${money(paid)} for ${money(total)}; rounding or fees)`,
      );
    } else if (paid < total) {
      amount = 'partial';
      if (partialKind) {
        score += 3;
        reasons.push(
          `${kindLabel(payment.paymentKind)} of ${money(paid)} on ${money(total)}`,
        );
      } else {
        score += 1;
        reasons.push(`Pays ${money(paid)} of ${money(total)}`);
      }
    } else {
      amount = 'over';
      reasons.push(`Pays ${money(paid)}, more than the ${money(total)} due`);
    }
  }

  // 4. An explicit reference: the invoice's number, or a document of its date.
  let reference: ReferenceEvidence = null;
  const number = canonicalCode(invoice.documentNumber);
  const usableNumber = number.length >= 2 && !/^0+$/.test(number);
  const description = canonicalCode(
    [payment.description, ...payment.subjects].join(' '),
  );
  const numberedRefs = payment.references.filter(
    (ref) => canonicalCode(ref.number).length >= 3,
  );
  if (
    usableNumber &&
    (payment.references.some((ref) => {
      const named = canonicalCode(ref.number);
      return (
        named === number ||
        (number.length >= 3 && named.length >= 3 && named.endsWith(number)) ||
        (named.length >= 3 && number.endsWith(named))
      );
    }) ||
      (number.length >= 4 && description.includes(number)))
  ) {
    reference = 'number';
    score += 6;
    reasons.push(
      `The payment names ${invoice.role === 'QUOTE' ? 'quote' : 'invoice'} ${invoice.documentNumber}`,
    );
  } else {
    const byDate =
      invoice.issueDate !== null &&
      payment.references.some(
        (ref) =>
          ref.date === invoice.issueDate &&
          (!usableNumber || !canonicalCode(ref.number)),
      );
    if (byDate) {
      reference = 'date';
      score += 3;
      const ref = payment.references.find((r) => r.date === invoice.issueDate);
      reasons.push(
        `The payment names a ${ref?.kind ?? 'document'} of ${day(invoice.issueDate!)}, the date of this one`,
      );
    } else if (usableNumber && numberedRefs.length) {
      score -= 2;
      reasons.push(
        `The payment names another document (${numberedRefs.map((ref) => ref.number).join(', ')})`,
      );
    }
  }

  // 5. The same purpose: words both descriptions share (property, service...).
  const invoiceWords = words(
    [invoice.description, invoice.documentKind, ...invoice.subjects].join(' '),
  );
  const partyWords = words(
    [
      invoice.counterparty.name,
      payment.counterparty.name,
      invoice.customer.name,
      payment.customer.name,
    ].join(' '),
  );
  const shared = [
    ...words([payment.description, ...payment.subjects].join(' ')),
  ].filter((word) => invoiceWords.has(word) && !partyWords.has(word));
  if (shared.length) {
    score += Math.min(3, shared.length);
    reasons.push(`Both mention ${shared.slice(0, 4).join(', ')}`);
  }

  // 6. Dates: close dates help a little; distant dates never rule it out.
  const paidOn = payment.paymentDate ?? payment.issueDate;
  const issuedOn = invoice.issueDate ?? invoice.dueDate;
  if (paidOn && issuedOn) {
    const days = daysBetween(issuedOn, paidOn);
    const toDue = invoice.dueDate
      ? Math.abs(daysBetween(invoice.dueDate, paidOn))
      : Infinity;
    if ((days >= -60 && days <= 120) || toDue <= 30) {
      score += days >= 0 ? 1.5 : 1;
      reasons.push(
        days === 0
          ? 'Paid the day it was issued'
          : days > 0
            ? `Paid ${days} day${days === 1 ? '' : 's'} after it was issued`
            : `Paid ${-days} day${days === -1 ? '' : 's'} before it was issued`,
      );
    } else if (Math.abs(days) > 400) {
      score -= 1;
      reasons.push('Paid more than a year apart from its date');
    }
  }

  return {
    score: round2(score),
    reasons,
    party,
    amount,
    reference,
    partialKind,
    sharedWords: shared.length,
  };
}

function kindLabel(kind: TransactionFacts['paymentKind']): string {
  switch (kind) {
    case 'ADVANCE':
      return 'An advance';
    case 'BALANCE':
      return 'A balance';
    case 'INSTALLMENT':
      return 'An instalment';
    default:
      return 'A partial payment';
  }
}

const strongParty = (pair: PairScore) =>
  pair.party === 'iban' || pair.party === 'id' || pair.party === 'name';

/** Worth showing at all: some tie to the supplier or an explicit reference, and enough points. */
export function isCandidate(pair: PairScore): boolean {
  return (
    pair.score >= SUGGEST_MIN_SCORE &&
    pair.amount !== 'mismatch' &&
    (pair.party !== null || pair.reference === 'number')
  );
}

/** Evidence enough to link on its own, if nothing else competes. */
export function isStrong(pair: PairScore): boolean {
  if (pair.score < AUTO_MIN_SCORE || pair.amount === 'mismatch') return false;
  const amountOk = pair.amount === 'exact' || pair.amount === 'close';
  const partialOk =
    pair.amount === 'partial' &&
    pair.partialKind &&
    (pair.reference !== null || pair.sharedWords > 0);
  return (
    (strongParty(pair) &&
      (amountOk || pair.reference === 'number' || partialOk)) ||
    (pair.reference === 'number' && amountOk)
  );
}

interface Scored {
  invoice: MatchDocument;
  pair: PairScore;
}

const pairKey = (invoiceId: string, paymentId: string) =>
  `${invoiceId}|${paymentId}`;

/**
 * Sets of 2 to 5 invoices whose totals add up to the payment. Two found:
 * ambiguous; none: no multi-invoice payment.
 */
function subsetsMatching(pool: Scored[], target: number): Scored[][] {
  const tolerance = amountTolerance(target);
  const found: Scored[][] = [];
  const items = pool.slice(0, 12);
  const walk = (start: number, chosen: Scored[], sum: number) => {
    if (found.length > 1) return;
    if (chosen.length >= 2 && Math.abs(sum - target) <= tolerance) {
      found.push([...chosen]);
      return;
    }
    if (chosen.length === 5) return;
    for (let i = start; i < items.length; i++) {
      const value = items[i].invoice.facts.amount ?? 0;
      if (sum + value > target + tolerance) continue;
      chosen.push(items[i]);
      walk(i + 1, chosen, sum + value);
      chosen.pop();
    }
  };
  walk(0, [], 0);
  return found;
}

/**
 * Every link the documents call for, besides your own decisions. Invoices and
 * quotes are matched separately: a payment "as per the quote" links to the
 * quote and to the invoice that followed it.
 */
export function proposeLinks(
  documents: MatchDocument[],
  decisions: LinkDecision[] = [],
): ProposedLink[] {
  const rejected = new Set(
    decisions
      .filter((decision) => decision.status === 'REJECTED')
      .map((decision) =>
        pairKey(decision.invoiceUploadId, decision.paymentUploadId),
      ),
  );
  const confirmed = decisions.filter(
    (decision) => decision.status === 'CONFIRMED',
  );
  const byId = new Map(documents.map((doc) => [doc.uploadId, doc]));
  const payments = documents
    .filter((doc) => doc.facts.role === 'PAYMENT')
    .sort((a, b) => a.uploadId.localeCompare(b.uploadId));
  const proposed: ProposedLink[] = [];
  /** Payments whose best candidate is a partial payment with no clear label, by invoice. */
  const partials = new Map<
    string,
    { payment: MatchDocument; pair: PairScore }[]
  >();

  for (const role of ['INVOICE', 'QUOTE'] as const) {
    const invoices = documents.filter((doc) => doc.facts.role === role);
    if (!invoices.length) continue;
    for (const payment of payments) {
      // You already matched this payment by hand with a document of this kind.
      if (
        confirmed.some(
          (decision) =>
            decision.paymentUploadId === payment.uploadId &&
            byId.get(decision.invoiceUploadId)?.facts.role === role,
        )
      )
        continue;
      const candidates: Scored[] = invoices
        .filter(
          (invoice) =>
            invoice.uploadId !== payment.uploadId &&
            !rejected.has(pairKey(invoice.uploadId, payment.uploadId)),
        )
        .map((invoice) => ({
          invoice,
          pair: scorePair(invoice.facts, payment.facts),
        }))
        .filter((scored) => isCandidate(scored.pair))
        .sort(
          (a, b) =>
            b.pair.score - a.pair.score ||
            a.invoice.uploadId.localeCompare(b.invoice.uploadId),
        );
      if (!candidates.length) continue;
      const link = (
        scored: Scored,
        status: ProposedLink['status'],
        extra: string[] = [],
      ) =>
        proposed.push({
          invoiceUploadId: scored.invoice.uploadId,
          paymentUploadId: payment.uploadId,
          status,
          score: scored.pair.score,
          reasons: [...extra, ...scored.pair.reasons],
        });

      const [best, next] = candidates;
      if (
        isStrong(best.pair) &&
        (!next || best.pair.score - next.pair.score >= AUTO_MARGIN)
      ) {
        link(best, 'AUTO');
        continue;
      }

      // One payment for several invoices of the same supplier.
      const paid = payment.facts.amount;
      if (paid !== null) {
        const pool = candidates.filter(
          (scored) =>
            strongParty(scored.pair) &&
            scored.pair.amount === 'over' &&
            (scored.invoice.facts.amount ?? 0) > 0,
        );
        const subsets = pool.length >= 2 ? subsetsMatching(pool, paid) : [];
        if (subsets.length === 1) {
          const set = subsets[0];
          const sum = round2(
            set.reduce((total, s) => total + (s.invoice.facts.amount ?? 0), 0),
          );
          for (const scored of set)
            link(scored, 'AUTO', [
              `Pays ${set.length} invoices together: ${set.map((s) => money(s.invoice.facts.amount ?? 0)).join(' + ')} = ${money(sum)}`,
            ]);
          continue;
        }
        if (subsets.length > 1) {
          for (const scored of pool.slice(0, MAX_SUGGESTIONS))
            link(scored, 'SUGGESTED', [
              'Needs your check: several sets of invoices add up to this payment',
            ]);
          continue;
        }
      }

      const contenders = candidates.filter(
        (scored) =>
          isStrong(scored.pair) ||
          best.pair.score - scored.pair.score < AUTO_MARGIN,
      );
      if (
        contenders.length === 1 &&
        best.pair.amount === 'partial' &&
        strongParty(best.pair)
      ) {
        const list = partials.get(best.invoice.uploadId) ?? [];
        list.push({ payment, pair: best.pair });
        partials.set(best.invoice.uploadId, list);
      }
      const note =
        contenders.length > 1
          ? `Needs your check: ${contenders.length} ${role === 'QUOTE' ? 'quotes' : 'invoices'} could match this payment`
          : 'Needs your check: the evidence is not conclusive';
      for (const scored of contenders.slice(0, MAX_SUGGESTIONS))
        link(scored, 'SUGGESTED', [note]);
    }
  }

  const allocated = (invoiceId: string, paymentId: string) =>
    Math.min(
      byId.get(paymentId)?.facts.amount ?? 0,
      byId.get(invoiceId)?.facts.amount ?? Infinity,
    );

  // Advance and balance with no label: together they add up to the total.
  for (const [invoiceId, list] of partials) {
    const invoice = byId.get(invoiceId);
    const total = invoice?.facts.amount;
    if (!invoice || total == null) continue;
    const settled = [
      ...proposed.filter(
        (link) => link.invoiceUploadId === invoiceId && link.status === 'AUTO',
      ),
      ...confirmed.filter((decision) => decision.invoiceUploadId === invoiceId),
    ].reduce(
      (sum, link) => sum + allocated(invoiceId, link.paymentUploadId),
      0,
    );
    const sum = list.reduce(
      (acc, item) => acc + (item.payment.facts.amount ?? 0),
      settled,
    );
    if (Math.abs(sum - total) > amountTolerance(total)) continue;
    for (const item of list) {
      const link = proposed.find(
        (l) =>
          l.invoiceUploadId === invoiceId &&
          l.paymentUploadId === item.payment.uploadId,
      );
      if (!link) continue;
      link.status = 'AUTO';
      link.reasons = [
        `With the other payments it adds up to the total of ${money(total)}`,
        ...link.reasons.filter(
          (reason) => !reason.startsWith('Needs your check'),
        ),
      ];
    }
  }

  // An invoice paid more than once over: the payments cannot all be its own.
  const invoiceIds = new Set(proposed.map((link) => link.invoiceUploadId));
  for (const invoiceId of invoiceIds) {
    const total = byId.get(invoiceId)?.facts.amount;
    if (total == null) continue;
    const autos = proposed.filter(
      (link) => link.invoiceUploadId === invoiceId && link.status === 'AUTO',
    );
    const confirmedHere = confirmed.filter(
      (decision) => decision.invoiceUploadId === invoiceId,
    );
    if (autos.length + confirmedHere.length < 2) continue;
    const sum = [...autos, ...confirmedHere].reduce(
      (acc, link) => acc + allocated(invoiceId, link.paymentUploadId),
      0,
    );
    if (sum <= total + amountTolerance(total)) continue;
    for (const link of autos) {
      const pair = scorePair(
        byId.get(invoiceId)!.facts,
        byId.get(link.paymentUploadId)!.facts,
      );
      if (pair.reference === 'number') continue;
      link.status = 'SUGGESTED';
      link.reasons = [
        `Needs your check: the payments found for it add up to more than its ${money(total)}`,
        ...link.reasons,
      ];
    }
  }

  return proposed;
}
