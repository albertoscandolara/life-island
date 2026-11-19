import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { ServiceDb } from '@life-island/be-common';
import {
  bankPaymentOf,
  paymentsByKey,
  isoAddDays,
  isoToday,
  listReceiptsQuerySchema,
  type PayableDto,
  type PayablesQuery,
  type PaymentRecord,
  type Page,
  type ReceiptDetailDto,
  type ReceiptDto,
  type ReceiptUpdateRequest,
  type SpendingDto,
} from '@life-island/contracts';
import {
  and,
  asc,
  count,
  desc,
  eq,
  gte,
  inArray,
  isNull,
  lt,
  sql,
  type SQL,
} from 'drizzle-orm';
import type { z } from 'zod';
import { SERVICE_DB } from '../config.js';
import {
  receiptDaysFor,
  receiptPayableKey,
  receiptPayables,
} from './payables.js';
import {
  merchants,
  payments,
  receiptItems,
  receipts,
  type MerchantRow,
  type ReceiptRow,
} from '../db/schema.js';

type ListReceipts = z.output<typeof listReceiptsQuerySchema>;

function nextDay(date: string): Date {
  const day = new Date(`${date}T00:00:00Z`);
  day.setUTCDate(day.getUTCDate() + 1);
  return day;
}

const TZ = () => process.env['SETTINGS_TIMEZONE'] || 'Europe/Rome';

export function toReceiptDto(
  row: ReceiptRow,
  merchant: MerchantRow,
  itemCount: number,
  paid: readonly PaymentRecord[] = [],
): ReceiptDto {
  return {
    id: row.id,
    sourceStagingId: row.sourceStagingId,
    uploadId: row.uploadId,
    title: row.title,
    notGroceries: row.notGroceries,
    merchant: {
      id: merchant.id,
      name: merchant.name,
      vatNumber: merchant.vatNumber,
      address: merchant.address,
    },
    purchasedAt: row.purchasedAt.toISOString(),
    currency: row.currency,
    total: row.total,
    paymentMethod: row.paymentMethod,
    itemCount,
    bankPayment: bankPaymentOf(row.total, paid),
  };
}

@Injectable()
export class ReceiptsService {
  constructor(@Inject(SERVICE_DB) private readonly svc: ServiceDb) {}

  async list(query: ListReceipts): Promise<Page<ReceiptDto>> {
    const conditions: SQL[] = [];
    if (query.from)
      conditions.push(
        gte(receipts.purchasedAt, new Date(`${query.from}T00:00:00Z`)),
      );
    if (query.to) conditions.push(lt(receipts.purchasedAt, nextDay(query.to)));
    if (query.merchantId)
      conditions.push(eq(receipts.merchantId, query.merchantId));
    const where = conditions.length ? and(...conditions) : undefined;
    const itemCount = sql<number>`(select count(*) from ${receiptItems} where ${receiptItems.receiptId} = ${receipts.id})::int`;
    const [rows, [{ total }]] = await Promise.all([
      this.svc.db
        .select({ receipt: receipts, merchant: merchants, itemCount })
        .from(receipts)
        .innerJoin(merchants, eq(merchants.id, receipts.merchantId))
        .where(where)
        .orderBy(desc(receipts.purchasedAt), desc(receipts.id))
        .limit(query.limit)
        .offset(query.offset),
      this.svc.db.select({ total: count() }).from(receipts).where(where),
    ]);
    const paid = await this.paymentsOf(rows.map((row) => row.receipt.id));
    return {
      items: rows.map((row) =>
        toReceiptDto(
          row.receipt,
          row.merchant,
          Number(row.itemCount),
          paid.get(receiptPayableKey(row.receipt.id)),
        ),
      ),
      total,
      limit: query.limit,
      offset: query.offset,
    };
  }

  async get(id: string): Promise<ReceiptDetailDto> {
    const [row] = await this.svc.db
      .select({ receipt: receipts, merchant: merchants })
      .from(receipts)
      .innerJoin(merchants, eq(merchants.id, receipts.merchantId))
      .where(eq(receipts.id, id));
    if (!row) throw new NotFoundException(`Receipt ${id} not found`);
    const items = await this.svc.db
      .select()
      .from(receiptItems)
      .where(eq(receiptItems.receiptId, id))
      .orderBy(asc(receiptItems.position));
    const paid = await this.paymentsOf([id]);
    return {
      ...toReceiptDto(
        row.receipt,
        row.merchant,
        items.length,
        paid.get(receiptPayableKey(id)),
      ),
      items: items.map((item) => ({
        position: item.position,
        rawName: item.rawName,
        normalizedName: item.normalizedName,
        category: item.category,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        lineTotal: item.lineTotal,
      })),
      documentFields:
        (row.receipt.documentFields as ReceiptDetailDto['documentFields']) ??
        null,
    };
  }

  /**
   * Your own name for a receipt (null goes back to the shop's name), and
   * whether it is groceries: one that is not leaves the Groceries page but
   * stays in `GET /payables`, so Money keeps matching and filing it.
   */
  async update(id: string, request: ReceiptUpdateRequest): Promise<void> {
    const set: Partial<ReceiptRow> = {};
    if (request.title !== undefined) set.title = request.title ?? null;
    if (request.notGroceries !== undefined)
      set.notGroceries = request.notGroceries;
    const rows = await this.svc.db
      .update(receipts)
      .set(Object.keys(set).length ? set : { title: sql`${receipts.title}` })
      .where(eq(receipts.id, id))
      .returning({ id: receipts.id });
    if (!rows.length) throw new NotFoundException(`Receipt ${id} not found`);
  }

  /** The document a receipt was read from. */
  async uploadOf(id: string): Promise<string> {
    const [row] = await this.svc.db
      .select({ uploadId: receipts.uploadId })
      .from(receipts)
      .where(eq(receipts.id, id));
    if (!row) throw new NotFoundException(`Receipt ${id} not found`);
    return row.uploadId;
  }

  /** The receipts and what they list, for Money matching (`GET /payables`). */
  async payables(query: PayablesQuery): Promise<PayableDto[]> {
    const days = receiptDaysFor(query);
    // A day of margin each side: purchasedAt is a moment, the day is Italy's.
    const rows = await this.svc.db
      .select({ receipt: receipts, merchant: merchants })
      .from(receipts)
      .innerJoin(merchants, eq(merchants.id, receipts.merchantId))
      .where(
        and(
          gte(
            receipts.purchasedAt,
            new Date(`${isoAddDays(days.from, -1)}T00:00:00Z`),
          ),
          lt(receipts.purchasedAt, nextDay(isoAddDays(days.to, 1))),
        ),
      );
    const items = rows.length
      ? await this.svc.db
          .select({
            receiptId: receiptItems.receiptId,
            name: receiptItems.normalizedName,
            category: receiptItems.category,
            lineTotal: receiptItems.lineTotal,
          })
          .from(receiptItems)
          .where(
            inArray(
              receiptItems.receiptId,
              rows.map((r) => r.receipt.id),
            ),
          )
          .orderBy(receiptItems.position)
      : [];
    return receiptPayables(
      rows.map(({ receipt, merchant }) => ({
        id: receipt.id,
        merchant: merchant.name,
        day: isoToday(TZ(), receipt.purchasedAt),
        total: receipt.total,
        currency: receipt.currency,
        paymentMethod: receipt.paymentMethod,
        items: items.filter((i) => i.receiptId === receipt.id),
      })),
      query,
    );
  }

  /** The payments matched in Money to these receipts, still linked, by payable key. */
  private async paymentsOf(
    ids: readonly string[],
  ): Promise<Map<string, PaymentRecord[]>> {
    if (!ids.length) return new Map();
    const rows = await this.svc.db
      .select()
      .from(payments)
      .where(
        and(
          inArray(payments.payableKey, ids.map(receiptPayableKey)),
          isNull(payments.unlinkedAt),
        ),
      );
    return paymentsByKey(rows);
  }

  /** Spending per month and item category, newest month first. */
  async spending(): Promise<SpendingDto[]> {
    const { rows } = await this.svc.db.execute<{
      month: string;
      category: string;
      total: string;
    }>(sql`
      select to_char(date_trunc('month', r.purchased_at), 'YYYY-MM') as month,
             i.category, sum(i.line_total) as total
        from ${receiptItems} i join ${receipts} r on r.id = i.receipt_id
       where not r.not_groceries and i.category <> 'digital'
       group by 1, 2
       order by 1 desc, 3 desc`);
    return rows.map((row) => ({
      month: row.month,
      category: row.category,
      total: Number(row.total),
    }));
  }
}
