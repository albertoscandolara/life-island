import {
  Inject,
  Injectable,
  NotFoundException,
  type OnApplicationBootstrap,
} from '@nestjs/common';
import type { ServiceDb } from '@life-island/be-common';
import { AiAssistant } from '@life-island/be-nest';
import {
  GROCERY_ITEM_CATEGORIES,
  isoAddMonths,
  isoToday,
  shoppingListOutputSchema,
  type ApplySuggestionRequest,
  type GroceriesOverviewDto,
  type GroceryItemCategory,
  type LifeQuestionRequest,
  type ShoppingSuggestionDto,
} from '@life-island/contracts';
import { desc, eq, inArray } from 'drizzle-orm';
import { CONFIG, SERVICE_DB, type GroceriesConfig } from '../config.js';
import {
  merchants,
  receipts,
  shoppingItems,
  shoppingSuggestions,
  type ShoppingSuggestionRow,
} from '../db/schema.js';
import { toReceiptDto } from '../receipts/receipts.service.js';
import {
  categorySpend,
  itemStats,
  LIST_INSTRUCTIONS,
  listDossier,
  months,
  offlineList,
  type PurchaseLine,
} from './stats.js';

/** The AI tool of Groceries (AI_TOOLS in libs/contracts settings.ts). */
export const LIST_TOOL = 'groceries.shopping-list';

const TZ = () => process.env['SETTINGS_TIMEZONE'] || 'Europe/Rome';
export const today = () => isoToday(TZ());

const LIST_STEP = {
  stepId: 'list',
  label: 'Suggest the list',
  system: LIST_INSTRUCTIONS,
  userTemplate:
    '{today, one line per item bought: times, about every how many days, days since the last, last price and change, shops and prices}\nAlready on the list: {…}\n\n{My request: <your request>, or: Suggest my shopping list.}',
  outputFormat: 'shoppingListOutput',
  effort: 'low' as const,
  maxTokens: 6000,
};

@Injectable()
export class ShoppingService implements OnApplicationBootstrap {
  private readonly ai: AiAssistant;

  constructor(
    @Inject(CONFIG) config: GroceriesConfig,
    @Inject(SERVICE_DB) private readonly svc: ServiceDb,
  ) {
    this.ai = new AiAssistant({
      toolId: LIST_TOOL,
      service: 'svc-groceries',
      apiKey: config.anthropicApiKey,
      defaultModel: config.aiModel,
      svc,
    });
  }

  async onApplicationBootstrap(): Promise<void> {
    await this.ai.describe([LIST_STEP]);
  }

  private get db() {
    return this.svc.db;
  }

  /** Every receipt line of the last 13 months, with its day and shop. */
  private async lines(day: string): Promise<PurchaseLine[]> {
    const { rows } = await this.svc.pool.query<{
      name: string;
      category: string;
      date: string;
      unit_price: string | null;
      line_total: string;
      merchant: string;
    }>(
      `select i.normalized_name as name, i.category,
              (r.purchased_at at time zone $2)::date::text as date,
              i.unit_price, i.line_total, m.name as merchant
         from ${this.svc.schema}.receipt_items i
         join ${this.svc.schema}.receipts r on r.id = i.receipt_id
         join ${this.svc.schema}.merchants m on m.id = r.merchant_id
        where r.purchased_at >= $1::date`,
      [isoAddMonths(`${day.slice(0, 7)}-01`, -12), TZ()],
    );
    return rows.map((r) => ({
      name: r.name,
      category: r.category,
      date: r.date,
      unitPrice: r.unit_price === null ? null : Number(r.unit_price),
      lineTotal: Number(r.line_total),
      merchant: r.merchant,
    }));
  }

  async overview(day = today()): Promise<GroceriesOverviewDto> {
    const since = isoAddMonths(`${day.slice(0, 7)}-01`, -12);
    const [lines, receiptRows, list, suggestionRows, aiList] =
      await Promise.all([
        this.lines(day),
        this.svc.pool.query<{
          id: string;
          date: string;
          total: string;
          merchant_id: string;
          merchant: string;
        }>(
          `select r.id, (r.purchased_at at time zone $2)::date::text as date, r.total,
                m.id as merchant_id, m.name as merchant
           from ${this.svc.schema}.receipts r join ${this.svc.schema}.merchants m on m.id = r.merchant_id
          where r.purchased_at >= $1::date`,
          [since, TZ()],
        ),
        this.db
          .select()
          .from(shoppingItems)
          .orderBy(
            shoppingItems.done,
            shoppingItems.category,
            shoppingItems.createdAt,
          ),
        this.db
          .select()
          .from(shoppingSuggestions)
          .orderBy(desc(shoppingSuggestions.createdAt))
          .limit(5),
        this.ai.active(),
      ]);
    const recentRows = await this.db
      .select({ receipt: receipts, merchant: merchants })
      .from(receipts)
      .innerJoin(merchants, eq(merchants.id, receipts.merchantId))
      .orderBy(desc(receipts.purchasedAt))
      .limit(10);
    const itemCounts = await this.svc.pool.query<{
      receipt_id: string;
      n: string;
    }>(
      `select receipt_id, count(*) as n from ${this.svc.schema}.receipt_items
        where receipt_id = any($1::uuid[]) group by receipt_id`,
      [recentRows.map((r) => r.receipt.id)],
    );
    const nItems = new Map(
      itemCounts.rows.map((r) => [r.receipt_id, Number(r.n)]),
    );
    const receiptList = receiptRows.rows.map((r) => ({
      ...r,
      total: Number(r.total),
    }));
    const monthList = months(receiptList, day);
    const full = monthList.slice(0, -1).filter((m) => m.receipts);
    const merchantStats = new Map<
      string,
      {
        id: string;
        name: string;
        receipts: number;
        total: number;
        lastVisit: string;
      }
    >();
    for (const r of receiptList) {
      const m = merchantStats.get(r.merchant_id) ?? {
        id: r.merchant_id,
        name: r.merchant,
        receipts: 0,
        total: 0,
        lastVisit: r.date,
      };
      m.receipts++;
      m.total = Math.round((m.total + r.total) * 100) / 100;
      if (r.date > m.lastVisit) m.lastVisit = r.date;
      merchantStats.set(r.merchant_id, m);
    }
    return {
      today: day,
      months: monthList,
      categories: categorySpend(lines, day),
      items: itemStats(lines),
      merchants: [...merchantStats.values()].sort((a, b) => b.total - a.total),
      recent: recentRows.map((r) =>
        toReceiptDto(r.receipt, r.merchant, nItems.get(r.receipt.id) ?? 0),
      ),
      totals: {
        thisMonth: monthList[11].total,
        lastMonth: monthList[10].total,
        averageMonth: full.length
          ? Math.round(
              (full.reduce((s, m) => s + m.total, 0) / full.length) * 100,
            ) / 100
          : 0,
        receipts: receiptList.length,
      },
      list: list.map((i) => ({ ...i, createdAt: i.createdAt.toISOString() })),
      suggestions: suggestionRows.map(toSuggestionDto),
      aiList,
    };
  }

  /** Clears the ticked items off the list. */
  async clearDone(): Promise<void> {
    await this.db.delete(shoppingItems).where(eq(shoppingItems.done, true));
  }

  async suggest(
    request: LifeQuestionRequest,
    day = today(),
  ): Promise<ShoppingSuggestionDto> {
    const [items, list] = await Promise.all([
      this.lines(day).then(itemStats),
      this.db
        .select({ name: shoppingItems.name })
        .from(shoppingItems)
        .where(eq(shoppingItems.done, false)),
    ]);
    const onList = list.map((i) => i.name);
    const question = request.question?.trim() || null;
    let row: Omit<ShoppingSuggestionRow, 'id' | 'createdAt'>;
    if (await this.ai.active()) {
      const answer = await this.ai.ask({
        step: LIST_STEP,
        output: shoppingListOutputSchema,
        user: `${listDossier(items, day, onList)}\n\n${question ? `My request: ${question}` : 'Suggest my shopping list.'}`,
      });
      row = {
        question,
        output: answer.output,
        source: 'claude',
        model: answer.model,
      };
    } else
      row = {
        question,
        output: offlineList(
          items,
          day,
          new Set(onList.map((n) => n.toLowerCase())),
        ),
        source: 'offline',
        model: null,
      };
    const [saved] = await this.db
      .insert(shoppingSuggestions)
      .values(row)
      .returning();
    const old = await this.db
      .select({ id: shoppingSuggestions.id })
      .from(shoppingSuggestions)
      .orderBy(desc(shoppingSuggestions.createdAt))
      .offset(10);
    if (old.length)
      await this.db.delete(shoppingSuggestions).where(
        inArray(
          shoppingSuggestions.id,
          old.map((o) => o.id),
        ),
      );
    return toSuggestionDto(saved);
  }

  /** Puts a suggestion's items (or the ones picked) on the list, skipping what is there. */
  async apply(
    id: string,
    request: ApplySuggestionRequest,
  ): Promise<{ added: number }> {
    const [suggestion] = await this.db
      .select()
      .from(shoppingSuggestions)
      .where(eq(shoppingSuggestions.id, id))
      .catch(() => []);
    if (!suggestion) throw new NotFoundException('Suggestion not found');
    const there = new Set(
      (
        await this.db
          .select({ name: shoppingItems.name })
          .from(shoppingItems)
          .where(eq(shoppingItems.done, false))
      ).map((i) => i.name.toLowerCase()),
    );
    const wanted = request.names
      ? new Set(request.names.map((n) => n.toLowerCase()))
      : null;
    const rows = suggestion.output.items
      .filter(
        (i) =>
          (!wanted || wanted.has(i.name.toLowerCase())) &&
          !there.has(i.name.toLowerCase()),
      )
      .map((i) => ({
        name: i.name.slice(0, 120),
        category: ((GROCERY_ITEM_CATEGORIES as readonly string[]).includes(
          i.category,
        )
          ? i.category
          : 'other') as GroceryItemCategory,
      }));
    if (rows.length) await this.db.insert(shoppingItems).values(rows);
    return { added: rows.length };
  }

  async removeSuggestion(id: string): Promise<void> {
    await this.db
      .delete(shoppingSuggestions)
      .where(eq(shoppingSuggestions.id, id));
  }
}

function toSuggestionDto(row: ShoppingSuggestionRow): ShoppingSuggestionDto {
  return { ...row, createdAt: row.createdAt.toISOString() };
}
