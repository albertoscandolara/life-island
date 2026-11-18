import type {
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
    .filter((p) => !proposed.has(p.key) && leftOf(p.amount, p.linked) > 0)
    .sort((a, b) => a.date.localeCompare(b.date) || a.key.localeCompare(b.key));
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

/** What a hand-picked link is for: as much as both sides have left. */
export function pickAmount(
  payable: MatchPayableDto,
  movement: MatchMovementDto,
): number {
  return Math.min(
    leftOf(payable.amount, payable.linked),
    leftOf(movement.amount, movement.linked),
  );
}

export const CONFIDENCE: Record<
  MatchConfidence,
  { label: string; tone: 'success' | 'info' | 'warning' }
> = {
  sure: { label: 'Sure', tone: 'success' },
  likely: { label: 'Likely', tone: 'info' },
  check: { label: 'Check it', tone: 'warning' },
};
