import {
  INCOME_CATEGORIES,
  isoAddDays,
  isoAddMonths,
  MONEY_CATEGORY_LABELS,
  type AccountDto,
  type BudgetDto,
  type CategorySpendDto,
  type MoneyCategory,
  type MonthFlowDto,
  type RecurringChargeDto,
  type SpendingReviewOutput,
  type TransactionDto,
} from '@life-island/contracts';

/*
 * Money as a pure computation: balances, months, categories, budgets and the
 * charges that come back, from the accounts and their movements.
 */

const round = (value: number) => Math.round(value * 100) / 100;

/** A transfer to savings is neither spending nor income. */
const counts = (t: Pick<TransactionDto, 'category'>) =>
  t.category !== 'savings';
const isSpending = (t: TransactionDto) => t.amount < 0 && counts(t);
const isIncome = (t: TransactionDto) => t.amount > 0 && counts(t);

export function withBalances(
  accounts: readonly Omit<AccountDto, 'balance' | 'movements'>[],
  transactions: readonly TransactionDto[],
): AccountDto[] {
  return accounts.map((a) => {
    const own = transactions.filter(
      (t) => t.accountId === a.id && t.date >= a.openingDate,
    );
    return {
      ...a,
      balance: round(a.openingBalance + own.reduce((s, t) => s + t.amount, 0)),
      movements: transactions.filter((t) => t.accountId === a.id).length,
    };
  });
}

/** `YYYY-MM` of the months from `count - 1` months ago to this one, oldest first. */
export function lastMonths(today: string, count: number): string[] {
  return Array.from({ length: count }, (_, i) =>
    isoAddMonths(`${today.slice(0, 7)}-01`, i - count + 1).slice(0, 7),
  );
}

export function monthFlows(
  transactions: readonly TransactionDto[],
  today: string,
): MonthFlowDto[] {
  return lastMonths(today, 12).map((month) => {
    const own = transactions.filter((t) => t.date.startsWith(month));
    const income = own.filter(isIncome).reduce((s, t) => s + t.amount, 0);
    const spending = -own.filter(isSpending).reduce((s, t) => s + t.amount, 0);
    return {
      month,
      income: round(income),
      spending: round(spending),
      net: round(income - spending),
    };
  });
}

function spentIn(
  transactions: readonly TransactionDto[],
  month: string,
  category: MoneyCategory,
): number {
  return -transactions
    .filter(
      (t) =>
        t.category === category && t.date.startsWith(month) && t.amount < 0,
    )
    .reduce((s, t) => s + t.amount, 0);
}

/** Spending per category this month against the three months before. */
export function categorySpend(
  transactions: readonly TransactionDto[],
  today: string,
): CategorySpendDto[] {
  const [m3, m2, m1, now] = lastMonths(today, 4);
  const categories = new Set(
    transactions.filter(isSpending).map((t) => t.category),
  );
  return [...categories]
    .filter((c) => !INCOME_CATEGORIES.includes(c))
    .map((category) => ({
      category,
      thisMonth: round(spentIn(transactions, now, category)),
      average: round(
        [m1, m2, m3].reduce(
          (s, m) => s + spentIn(transactions, m, category),
          0,
        ) / 3,
      ),
    }))
    .filter((c) => c.thisMonth > 0 || c.average > 0)
    .sort((a, b) => b.thisMonth - a.thisMonth || b.average - a.average);
}

export function withSpent(
  budgets: readonly Omit<BudgetDto, 'spent' | 'share'>[],
  transactions: readonly TransactionDto[],
  today: string,
): BudgetDto[] {
  const month = today.slice(0, 7);
  return budgets.map((b) => {
    const spent = round(spentIn(transactions, month, b.category));
    return {
      ...b,
      spent,
      share: b.monthlyLimit > 0 ? round(spent / b.monthlyLimit) : 0,
    };
  });
}

/** A description without dates, numbers and card codes: "NETFLIX.COM 12/03" → "netflix com". */
export function chargeKey(description: string): string {
  return description
    .toLowerCase()
    .replace(/[^a-zà-ù ]+/g, ' ')
    .split(/\s+/)
    .filter(
      (w) =>
        w.length > 1 &&
        ![
          'pagamento',
          'carta',
          'pos',
          'addebito',
          'sdd',
          'del',
          'presso',
        ].includes(w),
    )
    .slice(0, 3)
    .join(' ');
}

/**
 * The charges that came back in at least three different months of the last
 * six, at a similar amount, and were seen in the last 45 days.
 */
export function recurringCharges(
  transactions: readonly TransactionDto[],
  today: string,
): RecurringChargeDto[] {
  const since = isoAddMonths(today, -6);
  const groups = new Map<string, TransactionDto[]>();
  for (const t of transactions) {
    if (t.amount >= 0 || t.date < since || t.category === 'savings') continue;
    const key = chargeKey(t.description);
    if (key) groups.set(key, [...(groups.get(key) ?? []), t]);
  }
  const charges: RecurringChargeDto[] = [];
  for (const group of groups.values()) {
    const amounts = group.map((t) => -t.amount).sort((a, b) => a - b);
    const median = amounts[Math.floor(amounts.length / 2)];
    const similar = group.filter(
      (t) => Math.abs(-t.amount - median) <= Math.max(2, median * 0.25),
    );
    const months = new Set(similar.map((t) => t.date.slice(0, 7))).size;
    if (months < 3) continue;
    const last = similar.reduce((a, b) => (a.date > b.date ? a : b));
    if (last.date < isoAddDays(today, -45)) continue;
    charges.push({
      description: last.description,
      category: last.category,
      amount: round(median),
      months,
      lastDate: last.date,
      nextDate: isoAddMonths(last.date, 1),
      yearly: round(median * 12),
    });
  }
  return charges.sort((a, b) => b.yearly - a.yearly);
}

/** What you kept of what came in over the last three full months, 0–1. */
export function savingsRate(months: readonly MonthFlowDto[]): number | null {
  const full = months.slice(-4, -1);
  const income = full.reduce((s, m) => s + m.income, 0);
  if (income <= 0) return null;
  return round((income - full.reduce((s, m) => s + m.spending, 0)) / income);
}

const label = (c: MoneyCategory) => MONEY_CATEGORY_LABELS[c] ?? c;
const eur = (v: number) => `€${Math.round(v).toLocaleString('en-GB')}`;

/** The review written by Life Island's own rules. */
export function offlineReview(input: {
  months: readonly MonthFlowDto[];
  categories: readonly CategorySpendDto[];
  budgets: readonly BudgetDto[];
  recurring: readonly RecurringChargeDto[];
  rate: number | null;
}): SpendingReviewOutput {
  const { months, categories, budgets, recurring, rate } = input;
  const recent = months.slice(-4, -1);
  if (!recent.some((m) => m.income || m.spending))
    return {
      summary:
        'There are not enough movements yet for a review. Add your accounts and import a few months from your bank.',
      savings: [],
      warnings: [],
      goodHabits: [],
    };
  const avgSpending =
    recent.reduce((s, m) => s + m.spending, 0) / recent.length;
  const rising = categories.filter(
    (c) => c.average > 20 && c.thisMonth > c.average * 1.3,
  );
  const over = budgets.filter((b) => b.share > 1);
  const subscriptions = recurring.filter((r) => r.category === 'subscriptions');
  const savings: SpendingReviewOutput['savings'] = [];
  if (subscriptions.length)
    savings.push({
      title: 'Check your subscriptions',
      monthly: Math.round(subscriptions.reduce((s, r) => s + r.amount, 0) / 3),
      how: `You pay ${subscriptions.length} subscription${subscriptions.length === 1 ? '' : 's'} every month (${subscriptions
        .map((s) => s.description)
        .slice(0, 3)
        .join(
          ', ',
        )}). Cancelling the ones you rarely use often saves about a third.`,
    });
  for (const c of categories.filter((c) => c.average > 50).slice(0, 3))
    savings.push({
      title: `Spend less on ${label(c.category).toLowerCase()}`,
      monthly: Math.round(c.average * 0.1),
      how: `About ${eur(c.average)} a month goes there. A 10% cut is usually painless: set a budget and watch it here.`,
    });
  return {
    summary:
      `Over the last three months you spent about ${eur(avgSpending)} a month` +
      (rate === null
        ? '.'
        : rate >= 0
          ? ` and kept ${Math.round(rate * 100)}% of what came in.`
          : `, ${Math.round(-rate * 100)}% more than came in.`),
    savings: savings.slice(0, 5),
    warnings: [
      ...over.map(
        (b) =>
          `${label(b.category)} is over its budget: ${eur(b.spent)} of ${eur(b.monthlyLimit)}.`,
      ),
      ...rising.map(
        (c) =>
          `${label(c.category)} is up this month: ${eur(c.thisMonth)} against ${eur(c.average)} usually.`,
      ),
    ].slice(0, 3),
    goodHabits: [
      ...(rate !== null && rate >= 0.1
        ? [`You save ${Math.round(rate * 100)}% of your income: keep it up.`]
        : []),
      ...(budgets.length && !over.length
        ? ['Every budget is within its limit.']
        : []),
    ],
  };
}

export const REVIEW_INSTRUCTIONS = `You help one person keep their money under control with Life Island. You receive their last months of income and spending, their spending per category against the usual, their budgets, the charges that come back every month, and optionally a question.

Write a short spending review:
- summary: two or three sentences on how the money went lately, honest and calm.
- savings: up to five concrete changes, the biggest first, each with a realistic monthly saving in euro (0 if you cannot tell) and how to do it. Prefer cancelling or renegotiating recurring charges, then reducing categories that grew.
- warnings: up to three things to watch (overspent budgets, a category that jumped, a new recurring charge).
- goodHabits: up to three things going well.

Rules: use only the numbers given, never invent a movement. Amounts are in euro. Plain English, no jargon, no emojis. Never judge; suggest.`;

export function reviewDossier(input: {
  today: string;
  months: readonly MonthFlowDto[];
  categories: readonly CategorySpendDto[];
  budgets: readonly BudgetDto[];
  recurring: readonly RecurringChargeDto[];
  rate: number | null;
}): string {
  const { today, months, categories, budgets, recurring, rate } = input;
  return [
    `Today is ${today}.`,
    '<months>',
    ...months
      .slice(-6)
      .map(
        (m) =>
          `- ${m.month}: in ${eur(m.income)}, out ${eur(m.spending)}, net ${eur(m.net)}`,
      ),
    '</months>',
    `Savings rate over the last three full months: ${rate === null ? 'unknown' : `${Math.round(rate * 100)}%`}`,
    '<categories>',
    ...categories
      .slice(0, 15)
      .map(
        (c) =>
          `- ${label(c.category)}: this month ${eur(c.thisMonth)}, usually ${eur(c.average)}`,
      ),
    '</categories>',
    '<budgets>',
    ...budgets.map(
      (b) =>
        `- ${label(b.category)}: ${eur(b.spent)} of ${eur(b.monthlyLimit)}`,
    ),
    '</budgets>',
    '<recurring>',
    ...recurring
      .slice(0, 25)
      .map(
        (r) =>
          `- ${r.description} (${label(r.category)}): ${eur(r.amount)} a month, seen in ${r.months} months`,
      ),
    '</recurring>',
  ].join('\n');
}
