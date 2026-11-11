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

export const transactionRequestSchema = z.object({
  accountId: z.uuid(),
  date: lifeDate,
  /** Money in is positive, money out negative. */
  amount: lifeSignedAmount.refine((v) => v !== 0, 'An amount of 0 is not a movement'),
  description: lifeName(200),
  category: z.enum(MONEY_CATEGORIES).optional(),
  notes: lifeNote(500),
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
}>;

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
    /** Over the last 3 full months: what you kept of what came in, 0–1. */
    savingsRate: number | null;
    recurringYearly: number;
  };
  reviews: SpendingReviewDto[];
  aiReview: boolean;
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
    [/enel|eni plenitude|a2a|hera|iren|edison|acea|bolletta|gas|luce|acqua|tim |vodafone|wind|iliad|fastweb/, 'bills'],
    [/esselunga|coop|conad|carrefour|lidl|eurospin|pam |despar|iper|supermerc|aldi|penny/, 'groceries'],
    [/benzin|carbur|q8|tamoil|ip |esso|autostrad|telepass|trenitalia|italo|atm |metro|parchegg|taxi|uber/, 'transport'],
    [/farmac|medic|dentist|ospedal|asl|ticket sanit/, 'health'],
    [/netflix|spotify|disney|prime video|amazon prime|apple\.com|icloud|google storage|youtube|dazn|now tv|chatgpt|claude/, 'subscriptions'],
    [/ristorant|pizzer|bar |caffe|trattor|osteria|mcdonald|burger|sushi|deliveroo|glovo|just eat/, 'eating-out'],
    [/amazon|zalando|ikea|decathlon|mediaworld|unieuro|shein/, 'shopping'],
    [/ryanair|easyjet|ita airways|booking|airbnb|hotel|expedia/, 'travel'],
    [/f24|agenzia entrate|tribut|imu|tari|bollo|pagopa/, 'taxes'],
    [/cinema|teatro|museo|concert|palestra|gym|ticketone/, 'leisure'],
    [/scuola|universit|corso|udemy|libri|book/, 'education'],
  ];
  for (const [pattern, category] of rules)
    if (pattern.test(text)) return category;
  return amount > 0 ? 'other-income' : 'other';
}
