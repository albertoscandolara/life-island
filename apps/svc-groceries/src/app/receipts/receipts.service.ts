import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { ServiceDb } from '@life-island/be-common';
import {
  listReceiptsQuerySchema,
  type Page,
  type ReceiptDetailDto,
  type ReceiptDto,
  type SpendingDto,
} from '@life-island/contracts';
import { and, asc, count, desc, eq, gte, lt, sql, type SQL } from 'drizzle-orm';
import type { z } from 'zod';
import { SERVICE_DB } from '../config.js';
import {
  merchants,
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

function toReceiptDto(
  row: ReceiptRow,
  merchant: MerchantRow,
  itemCount: number,
): ReceiptDto {
  return {
    id: row.id,
    sourceStagingId: row.sourceStagingId,
    uploadId: row.uploadId,
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
    return {
      items: rows.map((row) =>
        toReceiptDto(row.receipt, row.merchant, Number(row.itemCount)),
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
    return {
      ...toReceiptDto(row.receipt, row.merchant, items.length),
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
       group by 1, 2
       order by 1 desc, 3 desc`);
    return rows.map((row) => ({
      month: row.month,
      category: row.category,
      total: Number(row.total),
    }));
  }
}
