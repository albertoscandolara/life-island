import {
  guessMoneyCategory,
  type AccountDto,
  type MoneyCategory,
  type MoneyChannel,
  type ReceiptReadingOutput,
  type TransactionDto,
  type TransactionRequest,
} from '@life-island/contracts';

/** One part of the movement in another category, as the form edits it. */
export interface SplitRow {
  category: MoneyCategory;
  /** Positive euro, as typed. */
  amount: number | null;
}

/** The receipt dialog's form: a new expense, or the details of a movement. */
export interface ReceiptForm {
  accountId: string | null;
  date: string;
  /** What was paid, positive (an expense goes out). */
  paid: number | null;
  description: string;
  category: MoneyCategory | null;
  channel: MoneyChannel | null;
  notes: string;
  splits: SplitRow[];
}

const round = (v: number) => Math.round(v * 100) / 100;

/** The account a cash receipt most likely went out of: cash first, then any open one. */
export function defaultAccount(accounts: readonly AccountDto[]): string | null {
  const open = accounts.filter((a) => !a.archived);
  return (open.find((a) => a.kind === 'cash') ?? open[0])?.id ?? null;
}

export function emptyForm(
  accounts: readonly AccountDto[],
  today: string,
): ReceiptForm {
  return {
    accountId: defaultAccount(accounts),
    date: today,
    paid: null,
    description: '',
    category: null,
    channel: null,
    notes: '',
    splits: [],
  };
}

export function formOf(movement: TransactionDto): ReceiptForm {
  return {
    accountId: movement.accountId,
    date: movement.date,
    paid: Math.abs(movement.amount),
    description: movement.description,
    category: movement.category,
    channel: movement.channel,
    notes: movement.notes ?? '',
    splits: movement.splits.map((s) => ({ ...s })),
  };
}

/**
 * The form with what the receipt reader found. On a movement from the bank
 * the bank's day, amount and description stay: the receipt adds the rest.
 */
export function withReading(
  form: ReceiptForm,
  reading: ReceiptReadingOutput,
  isNew: boolean,
): ReceiptForm {
  return {
    ...form,
    date: isNew && reading.date ? reading.date : form.date,
    paid: isNew && reading.total > 0 ? reading.total : form.paid,
    description:
      isNew && reading.merchant ? reading.merchant : form.description,
    category: reading.category,
    channel: reading.channel,
    notes: reading.note || form.notes,
    splits: reading.splits.map((s) => ({ ...s })),
  };
}

/** What stays in the movement's own category once the parts are taken out. */
export function restOf(form: ReceiptForm): number | null {
  if (form.paid === null) return null;
  return round(
    Math.abs(form.paid) -
      form.splits.reduce((s, p) => s + (Number(p.amount) || 0), 0),
  );
}

/** What is wrong with the form, in words, or null. */
export function formProblem(form: ReceiptForm, isNew: boolean): string | null {
  if (isNew) {
    if (!form.accountId) return 'Pick the account it was paid from.';
    if (!form.date) return 'Add the day of the purchase.';
    if (!form.paid || form.paid <= 0) return 'Add what you paid.';
    if (!form.description.trim()) return 'Add the shop.';
  }
  if (form.splits.some((s) => !s.amount || s.amount <= 0))
    return 'Each part needs an amount, or remove it.';
  const rest = restOf(form);
  if (rest !== null && rest < 0)
    return 'The parts add up to more than the movement.';
  return null;
}

/** The body for POST /transactions (a new expense: money out). */
export function newMovementRequest(form: ReceiptForm): TransactionRequest {
  const description = form.description.trim();
  const amount = -Math.abs(form.paid ?? 0);
  return {
    accountId: form.accountId ?? '',
    date: form.date,
    amount,
    description,
    category: form.category ?? guessMoneyCategory(description, amount),
    notes: form.notes.trim() || null,
    splits: cleanSplits(form),
    channel: form.channel,
  };
}

/** The body for PUT /transactions/:id: only what the receipt adds. */
export function detailsRequest(form: ReceiptForm): Partial<TransactionRequest> {
  return {
    ...(form.category ? { category: form.category } : {}),
    notes: form.notes.trim() || null,
    splits: cleanSplits(form),
    channel: form.channel,
  };
}

function cleanSplits(form: ReceiptForm) {
  return form.splits
    .filter((s) => s.amount && s.amount > 0 && s.category !== form.category)
    .map((s) => ({ category: s.category, amount: round(Number(s.amount)) }));
}
