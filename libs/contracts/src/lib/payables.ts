import { z } from 'zod';
import { ATTENTION_SOURCES, type AgendaSourceDto } from './agenda.js';
import { entityKey } from './entities.js';
import { isoDaysBetween } from './life-dates.js';
import { lifeDate } from './life-schemas.js';

/*
 * Money matching: what every area expects to pay or receive (`GET /payables`),
 * and the pure rules that pair it with the movements of your bank accounts.
 *
 * Life Island only proposes a pair; you confirm it in Money, and only then
 * does the area learn of it (the `money.payment-linked@1` event). The rules
 * here never decide: they rank, explain and say how sure they are.
 * docs/guides/money-matching.md has the whole design.
 */

/** Money leaving your accounts (a bill, an expense) or arriving (pay, a refund). */
export type PayableDirection = 'out' | 'in';

/**
 * One thing an area expects to be paid or to receive, as `GET /payables`
 * lists it. Areas list what is still open and what was paid recently, so a
 * link confirmed a while ago still finds its item.
 */
export interface PayableDto {
  /**
   * Stable and unique across the island: `<module>:<kind>:<id>`, for example
   * `home:bill:4d1c…`. Money stores links by it, and the area reads its own
   * keys back from the events.
   */
  key: string;
  /** The area (`home`, `taxes`, `subscriptions`…), as in AGENDA_SOURCES. */
  module: string;
  /** What it is in its area: `bill`, `expense`, `renewal`, `payslip`… */
  kind: string;
  /** How it reads in Money: "Enel Energia, electricity bill of oct 2026". */
  title: string;
  /**
   * The names a bank may print for the other side: supplier, provider,
   * issuer, shop, and their aliases from Companies. Empty when unknown.
   */
  payees: string[];
  /** Positive, in euros: what the area expects to move in total. */
  amount: number;
  direction: PayableDirection;
  /** When the money should move (a bill's due date, an expense's date). */
  date: string;
  /** The first and last day a movement can be this payment, both included. */
  window: { from: string; to: string };
  /**
   * How far the amount may differ and still be proposed, as a share of it:
   * 0 (the default) for an invoice, which is paid to the cent; 0.1 for a
   * subscription, so a price rise is caught (as a weaker match).
   */
  tolerance?: number;
  /** Paid on its own (direct debit, card on file): a movement is expected. */
  autoPay?: boolean;
  /** Where it is handled, in the Life Island app ("/home?tab=bills&bill=…"). */
  path: string | null;
}

/** A movement of your accounts, as the matcher reads it. */
export interface MatchMovement {
  id: string;
  date: string;
  /** Money in is positive, money out negative (TransactionDto). */
  amount: number;
  description: string;
}

/** A confirmed link: part (or all) of a movement pays part (or all) of a payable. */
export interface MatchLink {
  movementId: string;
  payableKey: string;
  /** Positive, in euros. */
  amount: number;
}

/** How sure the rules are about a proposed pair. */
export type MatchConfidence = 'sure' | 'likely' | 'check';

/** How the names on both sides compare. */
export type PayeeFit = 'agree' | 'partial' | 'differ' | 'unknown';

export interface MatchSuggestion {
  movementId: string;
  /** One payable, or several that one transfer paid together. */
  payableKeys: string[];
  /** What each payable would be linked for, in the order of `payableKeys`. */
  amounts: number[];
  confidence: MatchConfidence;
  /** Higher is better; only for ordering. */
  score: number;
  /** Why it is proposed, in plain words, the strongest first. */
  reasons: string[];
}

/** Two amounts are equal when they differ by less than half a cent. */
const CENT = 0.005;

/** What is left of a movement or a payable once its links are taken off. */
export function remaining(
  total: number,
  links: readonly MatchLink[],
  pick: (link: MatchLink) => boolean,
): number {
  const used = links.filter(pick).reduce((sum, link) => sum + link.amount, 0);
  return Math.round((Math.abs(total) - used) * 100) / 100;
}

/**
 * Words banks print around the name of the other side, which say nothing
 * about who it is: "ADDEBITO SDD", "BONIFICO A FAVORE DI", "PAGAMENTO POS".
 */
const BANK_WORDS = new Set([
  'addebito',
  'addebiti',
  'accredito',
  'diretto',
  'sdd',
  'sepa',
  'core',
  'rid',
  'bonifico',
  'bonif',
  'bon',
  'sct',
  'istantaneo',
  'favore',
  'disposizione',
  'ordinante',
  'beneficiario',
  'benef',
  'pagamento',
  'pagam',
  'pag',
  'pos',
  'carta',
  'card',
  'debit',
  'credit',
  'mastercard',
  'visa',
  'maestro',
  'bancomat',
  'operazione',
  'op',
  'cro',
  'trn',
  'rif',
  'causale',
  'fattura',
  'fatt',
  'ft',
  'num',
  'nr',
  'n',
  'del',
  'della',
  'dello',
  'dei',
  'di',
  'da',
  'a',
  'al',
  'per',
  'e',
  'il',
  'la',
  'lo',
  'cid',
  'mandato',
  'presso',
  'eur',
  'euro',
  'apple',
  'google',
  'pay',
  'paypal',
  'satispay',
]);

/**
 * Words that many different payees share: a payee named only by them
 * ("Farmacia Comunale", "Studio Medico") needs more than one of them in
 * the description to agree.
 */
const GENERIC_WORDS = new Set([
  'energia',
  'gas',
  'luce',
  'acqua',
  'servizi',
  'servizio',
  'service',
  'services',
  'italia',
  'italiana',
  'italy',
  'group',
  'gruppo',
  'holding',
  'assicurazioni',
  'assicurazione',
  'farmacia',
  'parafarmacia',
  'studio',
  'medico',
  'medica',
  'dentistico',
  'dott',
  'dottor',
  'dottoressa',
  'banca',
  'societa',
  'company',
  'store',
  'shop',
  'market',
  'supermercato',
  'supermercati',
  'centro',
  'comune',
  'mobile',
  'telecom',
  'retail',
  'distribuzione',
  'commerciale',
  'clinica',
  'ospedale',
  'laboratorio',
  'analisi',
  'ottica',
  'stazione',
  'servizio',
]);

/** The words of a bank description, without the bank's own words. */
export function bankWords(description: string): string[] {
  return (
    description
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .split(' ')
      // Codes (mandate ids, IBANs, card numbers, dates) carry digits: never a name.
      .filter((word) => word && !BANK_WORDS.has(word) && !/\d/.test(word))
  );
}

/** How one payee's name compares with a movement's description. */
export function payeeFit(description: string, payee: string): PayeeFit {
  const key = entityKey(payee);
  if (!key) return 'unknown';
  const printed = bankWords(description);
  // Nothing but bank words and codes: the bank did not say who it was.
  if (!printed.length) return 'unknown';
  const words = new Set(printed);
  const compact = printed.join('');
  const name = key
    .split(' ')
    .filter((w) => w.length >= 2 && !BANK_WORDS.has(w));
  if (!name.length) return 'unknown';
  // "ENELENERGIA" or "Enel Energia" written as one word by the bank.
  const joined = name.join('');
  if (joined.length >= 5 && compact.includes(joined)) return 'agree';
  const distinctive = name.filter(
    (w) => w.length >= 3 && !GENERIC_WORDS.has(w),
  );
  const found = distinctive.filter((w) => words.has(w));
  if (distinctive.length && found.length === distinctive.length) return 'agree';
  if (found.length) return 'partial';
  // A name made only of generic words ("Studio Medico") agrees only whole.
  return 'differ';
}

/** The best fit of any of a payable's names. */
export function bestPayeeFit(
  description: string,
  payees: readonly string[],
): PayeeFit {
  const order: PayeeFit[] = ['agree', 'partial', 'differ', 'unknown'];
  let best: PayeeFit = 'unknown';
  for (const payee of payees) {
    const fit = payeeFit(description, payee);
    if (order.indexOf(fit) < order.indexOf(best)) best = fit;
  }
  return best;
}

/** The key Money remembers a "Not this one" by. */
export function rejectionKey(movementId: string, payableKey: string): string {
  return `${movementId}|${payableKey}`;
}

interface Candidate {
  payable: PayableDto;
  /** What is left to link on the payable. */
  open: number;
  exact: boolean;
  days: number;
  fit: PayeeFit;
  score: number;
}

const FIT_SCORE: Record<PayeeFit, number> = {
  agree: 40,
  partial: 15,
  unknown: 0,
  differ: -25,
};

function daysText(days: number, payable: PayableDto): string {
  const what = payable.kind === 'bill' ? 'the due date' : 'its date';
  if (days === 0) return `on ${what}`;
  const n = Math.abs(days);
  return `${n} day${n === 1 ? '' : 's'} ${days > 0 ? 'after' : 'before'} ${what}`;
}

/**
 * The pairs to propose, at most one suggestion per movement (with its best
 * candidate; the others are still a click away in Money), the surest first.
 *
 * A pair is proposed only when the direction is the same, the movement's
 * date is inside the payable's window, neither side is fully linked, the
 * pair was not rejected, and the amount fits: to the cent, or within the
 * payable's tolerance. One transfer that paid two or three payables of one
 * area to the cent is proposed together.
 *
 * - sure: exact amount, the names agree, and no other movement or payable
 *   fits as well (on either side);
 * - likely: exact amount, nothing else fits, and the names do not disagree;
 * - check: everything else that is still worth a look.
 */
export function suggestMatches(
  movements: readonly MatchMovement[],
  payables: readonly PayableDto[],
  links: readonly MatchLink[],
  rejected: ReadonlySet<string> = new Set(),
): MatchSuggestion[] {
  const openPayables = payables
    .map((payable) => ({
      payable,
      open: remaining(
        payable.amount,
        links,
        (l) => l.payableKey === payable.key,
      ),
    }))
    .filter((p) => p.open > CENT);

  // Every fitting pair, per movement.
  const byMovement = new Map<
    string,
    { movement: MatchMovement; left: number; candidates: Candidate[] }
  >();
  for (const movement of movements) {
    if (!movement.amount) continue;
    const left = remaining(
      movement.amount,
      links,
      (l) => l.movementId === movement.id,
    );
    if (left <= CENT) continue;
    const direction: PayableDirection = movement.amount < 0 ? 'out' : 'in';
    const candidates: Candidate[] = [];
    for (const { payable, open } of openPayables) {
      if (payable.direction !== direction) continue;
      if (
        movement.date < payable.window.from ||
        movement.date > payable.window.to
      )
        continue;
      if (rejected.has(rejectionKey(movement.id, payable.key))) continue;
      const exact = Math.abs(left - open) < CENT;
      const tolerance = payable.tolerance ?? 0;
      const near =
        !exact &&
        tolerance > 0 &&
        Math.abs(left - open) <= open * tolerance + CENT;
      if (!exact && !near) continue;
      const days = isoDaysBetween(payable.date, movement.date);
      const fit = bestPayeeFit(movement.description, payable.payees);
      const score =
        (exact ? 50 : 20) + Math.max(0, 30 - Math.abs(days)) + FIT_SCORE[fit];
      candidates.push({ payable, open, exact, days, fit, score });
    }
    byMovement.set(movement.id, { movement, left, candidates });
  }

  // How many movements each payable fits exactly: a payable two movements fit
  // equally is never "sure" for either.
  const exactFits = new Map<string, number>();
  for (const { candidates } of byMovement.values())
    for (const c of candidates)
      if (c.exact && c.fit !== 'differ')
        exactFits.set(c.payable.key, (exactFits.get(c.payable.key) ?? 0) + 1);

  const suggestions: MatchSuggestion[] = [];
  for (const { movement, left, candidates } of byMovement.values()) {
    candidates.sort(
      (a, b) => b.score - a.score || a.payable.key.localeCompare(b.payable.key),
    );
    const best = candidates[0];
    if (best && best.fit !== 'differ') {
      const rivals = candidates.filter(
        (c) => c !== best && c.exact === best.exact && c.fit !== 'differ',
      );
      const alone =
        !rivals.length && (exactFits.get(best.payable.key) ?? 0) <= 1;
      const confidence: MatchConfidence =
        best.exact && alone && best.fit === 'agree'
          ? 'sure'
          : best.exact &&
              alone &&
              (best.fit === 'unknown' || best.fit === 'partial')
            ? 'likely'
            : 'check';
      const reasons = [
        best.exact
          ? 'same amount, to the cent'
          : `${
              (left - best.open > 0 ? '+' : '−') +
              Math.abs(left - best.open)
                .toFixed(2)
                .replace('.', ',')
            } € against the expected amount: the price may have changed`,
        daysText(best.days, best.payable),
        best.fit === 'agree'
          ? 'the description names the payee'
          : best.fit === 'partial'
            ? 'the description names part of the payee'
            : 'the description does not name the payee',
      ];
      if (rivals.length)
        reasons.push(
          `${rivals.length + 1} items fit this movement: pick the right one`,
        );
      else if ((exactFits.get(best.payable.key) ?? 0) > 1)
        reasons.push('another movement fits this item too');
      suggestions.push({
        movementId: movement.id,
        payableKeys: [best.payable.key],
        // A charge a little over its price (within the tolerance) is linked
        // whole, so the area sees what was really charged.
        amounts: [best.exact ? Math.min(left, best.open) : left],
        confidence,
        score: best.score,
        reasons,
      });
      continue;
    }
    // No single item fits: one transfer may have paid two or three of one area.
    const together = combination(movement, left, openPayables, rejected);
    if (together) suggestions.push(together);
  }

  const rank: Record<MatchConfidence, number> = {
    sure: 0,
    likely: 1,
    check: 2,
  };
  return suggestions.sort(
    (a, b) =>
      rank[a.confidence] - rank[b.confidence] ||
      b.score - a.score ||
      a.movementId.localeCompare(b.movementId),
  );
}

/** At most this many items are tried together, so the search stays small. */
const MAX_TOGETHER = 12;

/**
 * Two or three open items of one area, of the same payee, in the window, that
 * add up to the movement to the cent: one transfer that paid several
 * invoices. Always "check": you confirm which items it paid.
 */
function combination(
  movement: MatchMovement,
  left: number,
  openPayables: readonly { payable: PayableDto; open: number }[],
  rejected: ReadonlySet<string>,
): MatchSuggestion | null {
  const direction: PayableDirection = movement.amount < 0 ? 'out' : 'in';
  const pool = openPayables
    .filter(
      ({ payable, open }) =>
        payable.direction === direction &&
        !payable.tolerance &&
        open < left + CENT &&
        movement.date >= payable.window.from &&
        movement.date <= payable.window.to &&
        !rejected.has(rejectionKey(movement.id, payable.key)) &&
        bestPayeeFit(movement.description, payable.payees) === 'agree',
    )
    .slice(0, MAX_TOGETHER);
  const found: { payable: PayableDto; open: number }[][] = [];
  for (let i = 0; i < pool.length; i++)
    for (let j = i + 1; j < pool.length; j++) {
      const a = pool[i];
      const b = pool[j];
      if (a.payable.module !== b.payable.module) continue;
      if (Math.abs(a.open + b.open - left) < CENT) found.push([a, b]);
      for (let k = j + 1; k < pool.length; k++) {
        const c = pool[k];
        if (c.payable.module !== a.payable.module) continue;
        if (Math.abs(a.open + b.open + c.open - left) < CENT)
          found.push([a, b, c]);
      }
    }
  // Two different sets add up the same: too ambiguous to propose.
  if (found.length !== 1) return null;
  const [set] = found;
  return {
    movementId: movement.id,
    payableKeys: set.map((p) => p.payable.key),
    amounts: set.map((p) => p.open),
    confidence: 'check',
    score: 40,
    reasons: [
      `${set.length} items of the same payee add up to this movement, to the cent`,
      'the description names the payee',
      'check that one payment paid all of them',
    ],
  };
}

/**
 * Whether a set of links stays within both sides' amounts: a movement is
 * never linked for more than it moved, a payable never for more than it
 * costs. Returns the first problem, or null when all is well. Money checks
 * this before saving any link.
 */
export function linkProblem(
  links: readonly MatchLink[],
  movements: ReadonlyMap<string, MatchMovement>,
  payables: ReadonlyMap<string, Pick<PayableDto, 'amount' | 'tolerance'>>,
): string | null {
  for (const link of links)
    if (!(link.amount > 0)) return 'A link is for a positive amount.';
  const sum = (pick: (l: MatchLink) => string) => {
    const totals = new Map<string, number>();
    for (const link of links)
      totals.set(pick(link), (totals.get(pick(link)) ?? 0) + link.amount);
    return totals;
  };
  for (const [id, total] of sum((l) => l.movementId)) {
    const movement = movements.get(id);
    if (!movement) return 'The movement no longer exists.';
    if (total > Math.abs(movement.amount) + CENT)
      return 'These links add up to more than the movement.';
  }
  for (const [key, total] of sum((l) => l.payableKey)) {
    const payable = payables.get(key);
    // An item that is gone is not checked here: its link is flagged instead.
    if (!payable) continue;
    const allowed = payable.amount * (1 + (payable.tolerance ?? 0));
    if (total > allowed + CENT)
      return 'These links add up to more than the item costs.';
  }
  return null;
}

// ---------------------------------------------------------------------------
// Where the payables come from, and what Money and the areas exchange.
// ---------------------------------------------------------------------------

/**
 * The areas that publish `GET /payables`, in the order Money shows them. An
 * area joins by publishing the route and adding itself here; Money reads it
 * from PAYABLE_SOURCES (its env), like the Agenda reads AGENDA_SOURCES.
 */
export const PAYABLE_MODULES = [
  'home',
  'cars',
  'subscriptions',
  'work',
  'groceries',
  'taxes',
] as const;
export type PayableModule = (typeof PAYABLE_MODULES)[number];

/** The areas Money reads payables from, with their name and emblem. */
export const PAYABLE_SOURCES = PAYABLE_MODULES.map((module) => {
  const source = ATTENTION_SOURCES.find((s) => s.module === module);
  return {
    module,
    name: source?.name ?? module,
    emblem: source?.emblem ?? '•',
    path: source?.path ?? `/${module}`,
  };
});

/**
 * `GET /payables?from&to`: the items whose window touches these days, open or
 * paid. Money asks for the days of the movements it is matching.
 */
export const payablesQuerySchema = z
  .object({ from: lifeDate, to: lifeDate })
  .refine((q) => q.from <= q.to, 'from is after to');
export type PayablesQuery = z.infer<typeof payablesQuerySchema>;

/** `<module>:<kind>:<id>`: lower-case module and kind, an id without spaces. */
export const payableKeySchema = z
  .string()
  .max(200)
  .regex(
    /^[a-z][a-z0-9]*:[a-z][a-z0-9-]*:[A-Za-z0-9._-]+$/,
    'not a payable key',
  );

/** The module a payable key belongs to. */
export function payableModule(key: string): string {
  return key.split(':')[0] ?? '';
}

/**
 * Whether an item an area sent is well formed and its own: its key starts
 * with the area's module. Money drops anything else, so no area can answer
 * for another.
 */
export function isOwnPayable(
  value: unknown,
  module: string,
): value is PayableDto {
  if (!value || typeof value !== 'object') return false;
  const p = value as Partial<PayableDto>;
  const window = p.window as Partial<PayableDto['window']> | undefined;
  const isDate = (d: unknown) =>
    typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d);
  return (
    payableKeySchema.safeParse(p.key).success &&
    payableModule(p.key as string) === module &&
    p.module === module &&
    typeof p.kind === 'string' &&
    typeof p.title === 'string' &&
    Array.isArray(p.payees) &&
    p.payees.every((n) => typeof n === 'string') &&
    typeof p.amount === 'number' &&
    Number.isFinite(p.amount) &&
    p.amount > 0 &&
    (p.direction === 'out' || p.direction === 'in') &&
    isDate(p.date) &&
    !!window &&
    isDate(window.from) &&
    isDate(window.to) &&
    (window.from as string) <= (window.to as string) &&
    (p.tolerance === undefined ||
      (typeof p.tolerance === 'number' &&
        p.tolerance >= 0 &&
        p.tolerance <= 0.5)) &&
    (p.path === null || typeof p.path === 'string')
  );
}

const linkAmount = z.number().positive().max(10_000_000);

/**
 * `POST /matches/links`: you confirm that a movement paid one item, or
 * several that one transfer paid together. All are saved or none.
 */
export const matchLinkRequestSchema = z.object({
  movementId: z.uuid(),
  items: z
    .array(z.object({ payableKey: payableKeySchema, amount: linkAmount }))
    .min(1)
    .max(3)
    .refine(
      (items) => new Set(items.map((i) => i.payableKey)).size === items.length,
      'An item appears twice',
    ),
});
export type MatchLinkRequest = z.infer<typeof matchLinkRequestSchema>;

/** `POST /matches/rejections`: "not this one", remembered for the pair. */
export const matchRejectRequestSchema = z.object({
  movementId: z.uuid(),
  payableKeys: z.array(payableKeySchema).min(1).max(3),
});
export type MatchRejectRequest = z.infer<typeof matchRejectRequestSchema>;

/**
 * A confirmed link as Money shows it. `status` says whether the area still
 * agrees: `gone` when it no longer lists the item, `changed` when the item
 * now costs less than what is linked to it, `unknown` when the area did not
 * answer or the movement is older than what Money asked about.
 */
export interface MovementLinkDto {
  id: string;
  movementId: string;
  payableKey: string;
  module: string;
  amount: number;
  /** The item's title and page when you linked it, kept if the item goes. */
  title: string;
  path: string | null;
  /**
   * Linked by Money on its own: a sure match of an item paid automatically
   * (`autoPay`). Undoing it is remembered as "not this one".
   */
  auto: boolean;
  createdAt: string;
  status: 'ok' | 'gone' | 'changed' | 'unknown';
}

/** A movement on the "To match" tab, with its account. */
export interface MatchMovementDto extends MatchMovement {
  accountName: string;
  /** What is already linked of it (positive). */
  linked: number;
}

/** An item on the "To match" tab, with its area and what is already linked. */
export interface MatchPayableDto extends PayableDto {
  areaName: string;
  emblem: string;
  /** What is already linked to it (positive). */
  linked: number;
}

/** `GET /matches`: what Money proposes, and what you can pick by hand. */
export interface MatchesDto {
  /** The days the movements were read from. */
  from: string;
  to: string;
  /** Sure pairs first. */
  suggestions: MatchSuggestion[];
  /** The movements the suggestions and the open items refer to, by id. */
  movements: MatchMovementDto[];
  /** Every item the areas listed for these days, open or paid. */
  payables: MatchPayableDto[];
  /** The links of these days' movements, newest first. */
  links: MovementLinkDto[];
  /** Each area asked, and whether it answered. */
  sources: AgendaSourceDto[];
}

/**
 * Emitted by Money when you confirm a link. The area whose module the key
 * names marks its item paid (or partly paid) by `amount`. Areas keep it by
 * `linkId`, so redelivery or an unlink arriving first is harmless.
 */
export const PAYMENT_LINKED_EVENT = 'money.payment_linked@1';
export const paymentLinkedV1Schema = z.object({
  linkId: z.uuid(),
  payableKey: payableKeySchema,
  module: z.string().min(1),
  movementId: z.uuid(),
  /** The day the money moved. */
  date: lifeDate,
  /** What this link pays of the item (positive). */
  amount: linkAmount,
  accountName: z.string(),
  /** As the bank printed it. */
  description: z.string(),
  linkedAt: z.iso.datetime({ offset: true }),
});
export type PaymentLinkedV1 = z.infer<typeof paymentLinkedV1Schema>;

/**
 * Emitted by Money when a link is undone: by you, or because the movement
 * was removed or changed under it. The area forgets that payment.
 */
export const PAYMENT_UNLINKED_EVENT = 'money.payment_unlinked@1';
export const paymentUnlinkedV1Schema = z.object({
  linkId: z.uuid(),
  payableKey: payableKeySchema,
  module: z.string().min(1),
  reason: z.enum(['undone', 'movement-removed']),
  unlinkedAt: z.iso.datetime({ offset: true }),
});
export type PaymentUnlinkedV1 = z.infer<typeof paymentUnlinkedV1Schema>;

/**
 * What the matched bank movements paid of an item, as its area shows it
 * (a bill in Houses, an expense of the 730); null when none is.
 */
export interface BankPaymentDto {
  /** In euros, every matched movement together. */
  paid: number;
  /** Whether that covers the item's amount. */
  full: boolean;
  /** The day of the latest matched movement. */
  lastDate: string;
  /** The accounts it was paid from. */
  accounts: string[];
}

/** One row of an area's `payments` table (paymentEventHandler, libs/be-common). */
export interface PaymentRecord {
  amount: number;
  paidOn: string | null;
  accountName: string | null;
  unlinkedAt: Date | string | null;
}

/** What an item's payments add up to, only the links still in place. */
export function bankPaymentOf(
  due: number,
  payments: readonly PaymentRecord[],
): BankPaymentDto | null {
  const live = payments.filter((p) => p.unlinkedAt === null && p.paidOn);
  if (!live.length) return null;
  const paid =
    Math.round(live.reduce((sum, p) => sum + p.amount, 0) * 100) / 100;
  return {
    paid,
    full: paid + CENT >= due,
    lastDate: live
      .map((p) => p.paidOn as string)
      .sort()
      .at(-1) as string,
    accounts: [
      ...new Set(live.flatMap((p) => (p.accountName ? [p.accountName] : []))),
    ],
  };
}

/** An area's payment rows by the key of the item they pay. */
export function paymentsByKey<T extends { payableKey: string }>(
  rows: readonly T[],
): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const row of rows)
    map.set(row.payableKey, [...(map.get(row.payableKey) ?? []), row]);
  return map;
}
