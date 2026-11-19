import type {
  AccountDto,
  MatchConfidence,
  MatchesDto,
  MatchMovementDto,
  MatchPayableDto,
} from '@life-island/contracts';

/*
 * The "To match" tab's view of GET /matches: what is still open, and which
 * movements could have paid it when you pick one by hand.
 */

/** What is left of an amount once its links are taken off (never below 0). */
export function leftOf(total: number, linked: number): number {
  return Math.max(0, Math.round((Math.abs(total) - linked) * 100) / 100);
}

/**
 * The items still to be paid, earliest date first, leaving out the ones a
 * suggestion already proposes (they are shown there).
 */
export function openItems(matches: MatchesDto): MatchPayableDto[] {
  const proposed = new Set(matches.suggestions.flatMap((s) => s.payableKeys));
  return matches.payables
    .filter(
      (p) =>
        !p.paidInCash && !proposed.has(p.key) && leftOf(p.amount, p.linked) > 0,
    )
    .sort((a, b) => a.date.localeCompare(b.date) || a.key.localeCompare(b.key));
}

/**
 * The receipts paid in cash not yet in your movements: no bank movement
 * shows them, so each one is added to an account (a cash one) instead.
 * The newest first.
 */
export function cashItems(matches: MatchesDto): MatchPayableDto[] {
  return matches.payables
    .filter((p) => p.paidInCash && p.linked < 0.005)
    .sort((a, b) => b.date.localeCompare(a.date) || a.key.localeCompare(b.key));
}

/** The account cash most likely came out of: a cash one, else any open one. */
export function cashAccount(accounts: readonly AccountDto[]): string | null {
  const open = accounts.filter((a) => !a.archived);
  return (open.find((a) => a.kind === 'cash') ?? open[0])?.id ?? null;
}

/**
 * The movements that could have paid an item: the same direction, inside its
 * window, with something left. The closest amount first, then the closest day.
 */
export function candidates(
  matches: MatchesDto,
  payable: MatchPayableDto,
): MatchMovementDto[] {
  const due = leftOf(payable.amount, payable.linked);
  const days = (d: string) =>
    Math.abs(Date.parse(d) - Date.parse(payable.date)) / 86_400_000;
  return matches.movements
    .filter(
      (m) =>
        (payable.direction === 'out' ? m.amount < 0 : m.amount > 0) &&
        m.date >= payable.window.from &&
        m.date <= payable.window.to &&
        leftOf(m.amount, m.linked) > 0,
    )
    .sort(
      (a, b) =>
        Math.abs(leftOf(a.amount, a.linked) - due) -
          Math.abs(leftOf(b.amount, b.linked) - due) ||
        days(a.date) - days(b.date),
    );
}

/**
 * What a hand-picked link is for: as much as both sides have left. A charge a
 * little over the item's price, within its tolerance (a subscription's price
 * rise), is linked whole, as the matcher does.
 */
export function pickAmount(
  payable: MatchPayableDto,
  movement: MatchMovementDto,
): number {
  const due = leftOf(payable.amount, payable.linked);
  const left = leftOf(movement.amount, movement.linked);
  const allowed = leftOf(
    payable.amount * (1 + (payable.tolerance ?? 0)),
    payable.linked,
  );
  return left > due && left <= allowed ? left : Math.min(due, left);
}

export const CONFIDENCE: Record<
  MatchConfidence,
  { label: string; tone: 'success' | 'info' | 'warning' }
> = {
  sure: { label: 'Sure', tone: 'success' },
  likely: { label: 'Likely', tone: 'info' },
  check: { label: 'Check it', tone: 'warning' },
};
