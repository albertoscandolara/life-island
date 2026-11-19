import { z } from 'zod';
import {
  lifeAmount,
  lifeDate,
  lifeName,
  lifeNote,
  lifeSignedAmount,
  type LifeAiAnswerDto,
  type LifeRecord,
} from './life-schemas.js';

/*
 * Money (Spino, svc-money, mfe-money): your accounts and what goes in and out
 * of them, a monthly budget per category, the charges that come back every
 * month, and an AI review of your spending.
 */

export const ACCOUNT_KINDS = [
  'current',
  'savings',
  'card',
  'cash',
  'investment',
  'other',
] as const;
export type AccountKind = (typeof ACCOUNT_KINDS)[number];
export const ACCOUNT_KIND_LABELS: Record<AccountKind, string> = {
  current: 'Current account',
  savings: 'Savings',
  card: 'Prepaid or credit card',
  cash: 'Cash',
  investment: 'Investments',
  other: 'Other',
};

export const MONEY_CATEGORIES = [
  'salary',
  'other-income',
  'housing',
  'bills',
  'groceries',
  'transport',
  'health',
  'education',
  'eating-out',
  'leisure',
  'shopping',
  'travel',
  'subscriptions',
  'family',
  'gifts',
  'taxes',
  'savings',
  'other',
] as const;
export type MoneyCategory = (typeof MONEY_CATEGORIES)[number];
export const MONEY_CATEGORY_LABELS: Record<MoneyCategory, string> = {
  salary: 'Salary',
  'other-income': 'Other income',
  housing: 'Rent, mortgage, condo',
  bills: 'Bills',
  groceries: 'Groceries',
  transport: 'Transport and car',
  health: 'Health',
  education: 'Education',
  'eating-out': 'Eating out',
  leisure: 'Leisure',
  shopping: 'Shopping',
  travel: 'Travel',
  subscriptions: 'Subscriptions',
  family: 'Family and kids',
  gifts: 'Gifts and donations',
  taxes: 'Taxes and fees',
  savings: 'Moved to savings',
  other: 'Other',
};
export const INCOME_CATEGORIES: readonly MoneyCategory[] = [
  'salary',
  'other-income',
];

export const accountRequestSchema = z.object({
  name: lifeName(80),
  institution: lifeNote(80),
  kind: z.enum(ACCOUNT_KINDS).optional(),
  /** The balance on `openingDate`; movements after it add up from there. */
  openingBalance: lifeSignedAmount.optional(),
  openingDate: lifeDate.optional(),
  archived: z.boolean().optional(),
  notes: lifeNote(),
});
export type AccountRequest = z.input<typeof accountRequestSchema>;

/** Where a purchase was made: online (a cart and a checkout) or in a shop. */
export const MONEY_CHANNELS = ['online', 'store'] as const;
export type MoneyChannel = (typeof MONEY_CHANNELS)[number];
export const MONEY_CHANNEL_LABELS: Record<MoneyChannel, string> = {
  online: 'Online',
  store: 'In a shop',
};

/** The most parts one movement can be split into. */
export const MAX_SPLITS = 10;

/** A part of a movement in another category: a positive amount in euro. */
export const transactionSplitSchema = z.object({
  category: z.enum(MONEY_CATEGORIES),
  amount: lifeAmount.refine((v) => v > 0, 'A part must be more than 0'),
});
export type TransactionSplit = z.infer<typeof transactionSplitSchema>;

/**
 * What is wrong with the parts of a movement, or null: together they must
 * leave something for the movement's own category, or cover it exactly.
 */
export function splitsProblem(
  amount: number,
  splits: readonly { amount: number | string }[],
): string | null {
  const total = splits.reduce((s, p) => s + Number(p.amount), 0);
  if (Math.round(total * 100) > Math.round(Math.abs(amount) * 100))
    return `The parts add up to ${total.toFixed(2)}, more than the movement's ${Math.abs(amount).toFixed(2)}`;
  return null;
}

export const transactionRequestSchema = z.object({
  accountId: z.uuid(),
  date: lifeDate,
  /** Money in is positive, money out negative. */
  amount: lifeSignedAmount.refine(
    (v) => v !== 0,
    'An amount of 0 is not a movement',
  ),
  description: lifeName(200),
  category: z.enum(MONEY_CATEGORIES).optional(),
  notes: lifeNote(500),
  /**
   * Parts of the movement that belong to other categories (an Amazon order
   * of detergent and a phone case); the rest stays in `category`.
   */
  splits: z.array(transactionSplitSchema).max(MAX_SPLITS).optional(),
  /** Bought online or in a shop; null to guess it from the description. */
  channel: z.enum(MONEY_CHANNELS).nullable().optional(),
});
export type TransactionRequest = z.input<typeof transactionRequestSchema>;

/** Many movements at once, e.g. read from a bank's CSV export. */
export const transactionImportRequestSchema = z.object({
  accountId: z.uuid(),
  rows: z
    .array(
      z.object({
        date: lifeDate,
        amount: lifeSignedAmount,
        description: lifeName(200),
        category: z.enum(MONEY_CATEGORIES).optional(),
      }),
    )
    .min(1)
    .max(2000),
});
export type TransactionImportRequest = z.input<
  typeof transactionImportRequestSchema
>;

export const budgetRequestSchema = z.object({
  category: z.enum(MONEY_CATEGORIES),
  monthlyLimit: lifeAmount,
});
export type BudgetRequest = z.input<typeof budgetRequestSchema>;

export type AccountDto = LifeRecord<{
  name: string;
  institution: string | null;
  kind: AccountKind;
  openingBalance: number;
  openingDate: string;
  archived: boolean;
  notes: string | null;
}> & {
  /** Opening balance plus every movement since. */
  balance: number;
  movements: number;
};

export type TransactionDto = LifeRecord<{
  accountId: string;
  date: string;
  amount: number;
  description: string;
  category: MoneyCategory;
  notes: string | null;
  /** Parts in other categories, positive; the rest is in `category`. */
  splits: TransactionSplit[];
  /** Set by you; null: guessed from the description (`moneyChannel`). */
  channel: MoneyChannel | null;
}>;

/** One line of what was bought (`PayableLine`, from a receipt or an order). */
export interface PurchaseLine {
  name: string;
  amount: number;
  category: MoneyCategory;
}

/**
 * The note and the parts in other categories of a movement, from the lines
 * of its receipt. The note lists what was bought, the most expensive first,
 * so Movements finds it; the parts group the lines outside `category`, and
 * are left out when they would not fit in the movement.
 */
export function purchaseDetails(
  lines: readonly PurchaseLine[],
  category: MoneyCategory,
  amount: number,
): { notes: string | null; splits: TransactionSplit[] } {
  const euro = (v: number) => `€${v.toFixed(2)}`;
  const sorted = [...lines]
    .filter((l) => l.name.trim())
    .sort((a, b) => b.amount - a.amount);
  let notes = '';
  for (const line of sorted) {
    const text = `${line.name.trim()} ${euro(line.amount)}`;
    const next = notes ? `${notes}, ${text}` : text;
    if (next.length > 500) break;
    notes = next;
  }
  const byCategory = new Map<MoneyCategory, number>();
  for (const line of lines)
    if (line.category !== category && line.amount > 0)
      byCategory.set(
        line.category,
        (byCategory.get(line.category) ?? 0) + line.amount,
      );
  const splits = [...byCategory]
    .map(([c, v]) => ({ category: c, amount: Math.round(v * 100) / 100 }))
    .filter((s) => s.amount > 0)
    .sort((a, b) => b.amount - a.amount)
    .slice(0, MAX_SPLITS);
  return {
    notes: notes || null,
    splits: splitsProblem(amount, splits) ? [] : splits,
  };
}

/** The category most of the lines are in (by amount), or null with none. */
export function mainPurchaseCategory(
  lines: readonly PurchaseLine[],
): MoneyCategory | null {
  const totals = new Map<MoneyCategory, number>();
  for (const line of lines)
    totals.set(line.category, (totals.get(line.category) ?? 0) + line.amount);
  return [...totals].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
}

/** The online shops and marketplaces a bank names (keep in sync with `guessMoneyCategory`). */
const ONLINE_SHOPS =
  /amazon|amzn|zalando|shein|temu|aliexpress|ebay|vinted|subito|wallapop|asos|yoox|paypal|klarna|scalapay|etsy|veepee|privalia|groupon|booking|airbnb|deliveroo|glovo|just eat/;

/** Bought online or in a shop: what you said, else what the bank's text suggests. */
export function moneyChannel(
  t: Pick<TransactionDto, 'channel' | 'description'>,
): MoneyChannel {
  return (
    t.channel ??
    (ONLINE_SHOPS.test(t.description.toLowerCase()) ? 'online' : 'store')
  );
}

/** The categories counted in "Online or in a shop?": what is bought at a checkout. */
export const PURCHASE_CATEGORIES: readonly MoneyCategory[] = [
  'groceries',
  'shopping',
  'health',
  'leisure',
  'family',
  'gifts',
];

/** What went out on purchases in a month, online and in a shop. */
export interface PurchaseChannelsDto {
  /** `YYYY-MM`. */
  month: string;
  online: number;
  store: number;
}

export type BudgetDto = LifeRecord<{
  category: MoneyCategory;
  monthlyLimit: number;
}> & {
  /** What went out in the category this month. */
  spent: number;
  /** 0–1+, spent over the limit. */
  share: number;
};

/** A charge that came back in at least three different months. */
export interface RecurringChargeDto {
  description: string;
  category: MoneyCategory;
  /** The typical amount, positive. */
  amount: number;
  months: number;
  lastDate: string;
  /** When it should come again, a month after the last one. */
  nextDate: string;
  yearly: number;
}

export interface MonthFlowDto {
  /** `YYYY-MM`. */
  month: string;
  income: number;
  spending: number;
  net: number;
  /** What went out, by category (positive; categories with none left out). */
  spendingBy: Partial<Record<MoneyCategory, number>>;
}

export interface CategorySpendDto {
  category: MoneyCategory;
  thisMonth: number;
  /** The average of the three months before. */
  average: number;
}

export const spendingReviewOutputSchema = z.object({
  summary: z
    .string()
    .describe('Two or three sentences: how the money went lately'),
  savings: z
    .array(
      z.object({
        title: z.string().describe('What to change, verb first'),
        monthly: z
          .number()
          .describe('A realistic saving per month in euro, 0 if unknown'),
        how: z.string().describe('How, in one or two sentences'),
      }),
    )
    .describe('Up to five savings, the biggest first'),
  warnings: z
    .array(z.string())
    .describe('Up to three things to watch: overspent budgets, new charges'),
  goodHabits: z
    .array(z.string())
    .describe('Up to three things that are going well'),
});
export type SpendingReviewOutput = z.infer<typeof spendingReviewOutputSchema>;
export type SpendingReviewDto = LifeAiAnswerDto<SpendingReviewOutput>;

export interface MoneyOverviewDto {
  today: string;
  accounts: AccountDto[];
  /** The last 13 months of movements, newest first. */
  transactions: TransactionDto[];
  budgets: BudgetDto[];
  recurring: RecurringChargeDto[];
  /** The last 12 months, oldest first. */
  months: MonthFlowDto[];
  categories: CategorySpendDto[];
  totals: {
    balance: number;
    incomeThisMonth: number;
    spendingThisMonth: number;
    /** Last month from the 1st to today's day of the month, to compare with this month so far. */
    lastMonthToDate: { income: number; spending: number };
    /** The total balance of the open accounts one month ago. */
    balanceMonthAgo: number;
    /** Over the last 3 full months: what you kept of what came in, 0–1. */
    savingsRate: number | null;
    recurringYearly: number;
  };
  reviews: SpendingReviewDto[];
  aiReview: boolean;
  /** What the movements above paid or received in other areas (Money matching). */
  paidItems: MovementPaidItemDto[];
  /** The last 6 months of purchases, online and in a shop, oldest first. */
  purchaseChannels: PurchaseChannelsDto[];
}

/** One item of another area a movement paid, linked on the "To match" tab. */
export interface MovementPaidItemDto {
  movementId: string;
  module: string;
  /** The area's name and emblem (PAYABLE_SOURCES). */
  areaName: string;
  emblem: string;
  /** The item's title and page when it was linked. */
  title: string;
  path: string | null;
  amount: number;
  /** Linked by Money on its own (a sure direct debit). */
  auto: boolean;
}

/** The category a description most likely belongs to, from a few keywords. */
export function guessMoneyCategory(
  description: string,
  amount: number,
): MoneyCategory {
  const text = description.toLowerCase();
  const rules: [RegExp, MoneyCategory][] = [
    [/stipend|salary|retribuz|emolument|busta paga/, 'salary'],
    [/affitto|rent|mutuo|mortgage|condomin/, 'housing'],
    [
      /enel|eni plenitude|a2a|hera|iren|edison|acea|bolletta|gas|luce|acqua|tim |vodafone|wind|iliad|fastweb/,
      'bills',
    ],
    [
      /esselunga|coop|conad|carrefour|lidl|eurospin|pam |despar|iper|supermerc|aldi|penny/,
      'groceries',
    ],
    [
      /benzin|carbur|q8|tamoil|ip |esso|autostrad|telepass|trenitalia|italo|atm |metro|parchegg|taxi|uber/,
      'transport',
    ],
    [/farmac|medic|dentist|ospedal|asl|ticket sanit/, 'health'],
    [
      /netflix|spotify|disney|prime video|amazon prime|apple\.com|icloud|google storage|youtube|dazn|now tv|chatgpt|claude/,
      'subscriptions',
    ],
    [
      /ristorant|pizzer|bar |caffe|trattor|osteria|mcdonald|burger|sushi|deliveroo|glovo|just eat/,
      'eating-out',
    ],
    [
      /amazon|amzn|zalando|ikea|decathlon|mediaworld|unieuro|shein|temu|aliexpress|ebay/,
      'shopping',
    ],
    [/ryanair|easyjet|ita airways|booking|airbnb|hotel|expedia/, 'travel'],
    [/f24|agenzia entrate|tribut|imu|tari|bollo|pagopa/, 'taxes'],
    [/cinema|teatro|museo|concert|palestra|gym|ticketone/, 'leisure'],
    [/scuola|universit|corso|udemy|libri|book/, 'education'],
  ];
  for (const [pattern, category] of rules)
    if (pattern.test(text)) return category;
  return amount > 0 ? 'other-income' : 'other';
}
