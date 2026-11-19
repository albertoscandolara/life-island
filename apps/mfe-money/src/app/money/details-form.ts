import type {
  MoneyCategory,
  MoneyChannel,
  TransactionDto,
  TransactionRequest,
} from '@life-island/contracts';

/** One part of the movement in another category, as the form edits it. */
export interface SplitRow {
  category: MoneyCategory;
  /** Positive euro, as typed. */
  amount: number | null;
}

/** The details of a movement: its category, where it was bought, a note, parts. */
export interface DetailsForm {
  /** What moved, positive. */
  paid: number;
  category: MoneyCategory;
  channel: MoneyChannel | null;
  notes: string;
  splits: SplitRow[];
}

const round = (v: number) => Math.round(v * 100) / 100;

export function formOf(movement: TransactionDto): DetailsForm {
  return {
    paid: Math.abs(movement.amount),
    category: movement.category,
    channel: movement.channel,
    notes: movement.notes ?? '',
    splits: movement.splits.map((s) => ({ ...s })),
  };
}

/** What stays in the movement's own category once the parts are taken out. */
export function restOf(form: DetailsForm): number {
  return round(
    form.paid - form.splits.reduce((s, p) => s + (Number(p.amount) || 0), 0),
  );
}

/** What is wrong with the form, in words, or null. */
export function formProblem(form: DetailsForm): string | null {
  if (form.splits.some((s) => !s.amount || s.amount <= 0))
    return 'Each part needs an amount, or remove it.';
  if (restOf(form) < 0) return 'The parts add up to more than the movement.';
  return null;
}

/** The body for PUT /transactions/:id: only the details. */
export function detailsRequest(form: DetailsForm): Partial<TransactionRequest> {
  return {
    category: form.category,
    notes: form.notes.trim() || null,
    splits: form.splits
      .filter((s) => s.amount && s.amount > 0 && s.category !== form.category)
      .map((s) => ({ category: s.category, amount: round(Number(s.amount)) })),
    channel: form.channel,
  };
}
