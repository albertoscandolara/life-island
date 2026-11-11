import { Inject, Injectable, type OnApplicationBootstrap } from '@nestjs/common';
import type { ServiceDb } from '@life-island/be-common';
import { AiAssistant, requireRow } from '@life-island/be-nest';
import {
  deadlineWindow,
  guessMoneyCategory,
  inDeadlineWindow,
  isoAddMonths,
  isoDaysBetween,
  isoToday,
  spendingReviewOutputSchema,
  type DeadlineDto,
  type DeadlinesQuery,
  type LifeAttentionDto,
  type LifeQuestionRequest,
  type MoneyOverviewDto,
  type SpendingReviewDto,
  type TransactionDto,
  type TransactionImportRequest,
} from '@life-island/contracts';
import { desc, eq, gte, inArray } from 'drizzle-orm';
import { CONFIG, SERVICE_DB, type ServiceConfig } from '../config.js';
import {
  accounts,
  budgets,
  spendingReviews,
  transactions,
  type SpendingReviewRow,
  type TransactionRow,
} from '../db/schema.js';
import {
  categorySpend,
  monthFlows,
  offlineReview,
  recurringCharges,
  REVIEW_INSTRUCTIONS,
  reviewDossier,
  savingsRate,
  withBalances,
  withSpent,
} from './analysis.js';

/** The AI tool of Money (AI_TOOLS in libs/contracts settings.ts). */
export const REVIEW_TOOL = 'money.spending-review';

export function today(): string {
  return isoToday(process.env['SETTINGS_TIMEZONE'] || 'Europe/Rome');
}

const REVIEW_STEP = {
  stepId: 'review',
  label: 'Review the spending',
  system: REVIEW_INSTRUCTIONS,
  userTemplate:
    '{today, the last 6 months in and out, the savings rate, spending per category against the usual, budgets, recurring charges}\n\n{My question: <your question>, or: Review my spending.}',
  outputFormat: 'spendingReviewOutput',
  effort: 'low' as const,
  maxTokens: 6000,
};

@Injectable()
export class MoneyService implements OnApplicationBootstrap {
  private readonly ai: AiAssistant;

  constructor(
    @Inject(CONFIG) config: ServiceConfig,
    @Inject(SERVICE_DB) private readonly svc: ServiceDb,
  ) {
    this.ai = new AiAssistant({
      toolId: REVIEW_TOOL,
      service: 'svc-money',
      apiKey: config.anthropicApiKey,
      defaultModel: config.aiModel,
      svc,
    });
  }

  async onApplicationBootstrap(): Promise<void> {
    await this.ai.describe([REVIEW_STEP]);
  }

  private get db() {
    return this.svc.db;
  }

  /** Accounts, the last 13 months of movements and everything computed from them. */
  private async state(day: string) {
    const since = isoAddMonths(`${day.slice(0, 7)}-01`, -12);
    const [accountRows, txRows, budgetRows, olderSums] = await Promise.all([
      this.db.select().from(accounts).orderBy(accounts.name),
      this.db
        .select()
        .from(transactions)
        .where(gte(transactions.date, since))
        .orderBy(desc(transactions.date), desc(transactions.createdAt)),
      this.db.select().from(budgets).orderBy(budgets.category),
      // Movements older than 13 months still count in the balances.
      this.svc.pool.query<{ account_id: string; date: string; total: string }>(
        `select t.account_id, min(t.date)::text as date, sum(t.amount) as total
           from ${this.svc.schema}.transactions t
           join ${this.svc.schema}.accounts a on a.id = t.account_id
          where t.date < $1 and t.date >= a.opening_date
          group by t.account_id`,
        [since],
      ),
    ]);
    const txs = txRows.map(toTransactionDto);
    const older: TransactionDto[] = olderSums.rows.map((r) => ({
      id: `older:${r.account_id}`,
      accountId: r.account_id,
      date: r.date,
      amount: Number(r.total),
      description: 'Older movements',
      category: 'other',
      notes: null,
      createdAt: '',
    }));
    const months = monthFlows(txs, day);
    const budgetDtos = withSpent(
      budgetRows.map((b) => ({ ...b, createdAt: b.createdAt.toISOString() })),
      txs,
      day,
    );
    return {
      accounts: withBalances(
        accountRows.map((a) => ({ ...a, createdAt: a.createdAt.toISOString() })),
        [...txs, ...older],
      ).map((a) => ({
        ...a,
        movements: txs.filter((t) => t.accountId === a.id).length,
      })),
      transactions: txs,
      budgets: budgetDtos,
      recurring: recurringCharges(txs, day),
      months,
      categories: categorySpend(txs, day),
      rate: savingsRate(months),
    };
  }

  async overview(day = today()): Promise<MoneyOverviewDto> {
    const [state, reviewRows, aiReview] = await Promise.all([
      this.state(day),
      this.db
        .select()
        .from(spendingReviews)
        .orderBy(desc(spendingReviews.createdAt))
        .limit(5),
      this.ai.active(),
    ]);
    const thisMonth = state.months[state.months.length - 1];
    return {
      today: day,
      accounts: state.accounts,
      transactions: state.transactions,
      budgets: state.budgets,
      recurring: state.recurring,
      months: state.months,
      categories: state.categories,
      totals: {
        balance: Math.round(
          state.accounts
            .filter((a) => !a.archived)
            .reduce((s, a) => s + a.balance, 0) * 100,
        ) / 100,
        incomeThisMonth: thisMonth.income,
        spendingThisMonth: thisMonth.spending,
        savingsRate: state.rate,
        recurringYearly: Math.round(
          state.recurring.reduce((s, r) => s + r.yearly, 0),
        ),
      },
      reviews: reviewRows.map(toReviewDto),
      aiReview,
    };
  }

  /** The recurring charges expected next, and the budgets already over. */
  async deadlines(query: DeadlinesQuery, day = today()): Promise<DeadlineDto[]> {
    const window = deadlineWindow(query, day);
    const state = await this.state(day);
    return state.recurring
      .filter((r) => inDeadlineWindow(r.nextDate, window))
      .map((r) => ({
        id: `recurring:${r.description.toLowerCase().replace(/\W+/g, '-')}:${r.nextDate}`,
        module: 'money',
        kind: 'recurring',
        title: `${r.description} is charged again`,
        detail: `Seen in ${r.months} months; about €${r.amount} each time.`,
        date: r.nextDate,
        amount: r.amount,
        path: '/money?tab=recurring',
      }));
  }

  async attention(day = today()): Promise<LifeAttentionDto> {
    const state = await this.state(day);
    const soon = state.recurring.filter(
      (r) => isoDaysBetween(day, r.nextDate) >= 0 && isoDaysBetween(day, r.nextDate) <= 7,
    );
    return {
      expired: state.budgets.filter((b) => b.share > 1).length,
      expiring: soon.length,
      toReview: 0,
    };
  }

  /** Adds many movements at once; ones already there (same day, amount, description) are skipped. */
  async importTransactions(
    request: TransactionImportRequest,
  ): Promise<{ added: number; skipped: number }> {
    await requireRow(this.db, accounts, request.accountId, 'Account');
    const existing = await this.db
      .select({
        date: transactions.date,
        amount: transactions.amount,
        description: transactions.description,
      })
      .from(transactions)
      .where(eq(transactions.accountId, request.accountId));
    const key = (r: { date: string; amount: number; description: string }) =>
      `${r.date}|${Number(r.amount).toFixed(2)}|${r.description.trim().toLowerCase()}`;
    const seen = new Set(existing.map(key));
    const rows = [];
    for (const row of request.rows) {
      const amount = Number(row.amount);
      const k = key({ ...row, amount });
      if (seen.has(k) || amount === 0) continue;
      seen.add(k);
      rows.push({
        accountId: request.accountId,
        date: row.date,
        amount,
        description: row.description,
        category: row.category ?? guessMoneyCategory(row.description, amount),
      });
    }
    for (let i = 0; i < rows.length; i += 500)
      await this.db.insert(transactions).values(rows.slice(i, i + 500));
    return { added: rows.length, skipped: request.rows.length - rows.length };
  }

  async writeReview(
    request: LifeQuestionRequest,
    day = today(),
  ): Promise<SpendingReviewDto> {
    const state = await this.state(day);
    const question = request.question?.trim() || null;
    const facts = { today: day, ...state };
    let row: Omit<SpendingReviewRow, 'id' | 'createdAt'>;
    if (await this.ai.active()) {
      const answer = await this.ai.ask({
        step: REVIEW_STEP,
        output: spendingReviewOutputSchema,
        user: `${reviewDossier(facts)}\n\n${question ? `My question: ${question}` : 'Review my spending.'}`,
      });
      row = { question, output: answer.output, source: 'claude', model: answer.model };
    } else
      row = { question, output: offlineReview(facts), source: 'offline', model: null };
    const [saved] = await this.db.insert(spendingReviews).values(row).returning();
    const old = await this.db
      .select({ id: spendingReviews.id })
      .from(spendingReviews)
      .orderBy(desc(spendingReviews.createdAt))
      .offset(10);
    if (old.length)
      await this.db
        .delete(spendingReviews)
        .where(inArray(spendingReviews.id, old.map((o) => o.id)));
    return toReviewDto(saved);
  }

  async removeReview(id: string): Promise<void> {
    await this.db.delete(spendingReviews).where(eq(spendingReviews.id, id));
  }
}

export function toTransactionDto(row: TransactionRow): TransactionDto {
  return { ...row, amount: Number(row.amount), createdAt: row.createdAt.toISOString() };
}

function toReviewDto(row: SpendingReviewRow): SpendingReviewDto {
  return { ...row, createdAt: row.createdAt.toISOString() };
}

