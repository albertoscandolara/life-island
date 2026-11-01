import type { RecordLoader } from '@life-island/be-common';
import type { GroceryReceiptV1 } from '@life-island/contracts';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { merchants, receiptItems, receipts } from '../db/schema.js';

/** How a merchant is recognised again: its VAT number, else its name. */
export function merchantKey(merchant: GroceryReceiptV1['merchant']): string {
  const vat = merchant.vatNumber?.replace(/[\s.-]/g, '').toUpperCase();
  if (vat) return `vat:${vat.replace(/^IT/, '')}`;
  return `name:${merchant.name.trim().replace(/\s+/g, ' ').toLowerCase()}`;
}

/**
 * Loads a confirmed `grocery.receipt@1`: upserts the merchant, inserts the
 * receipt and its items. A replay of the same review record finds the
 * receipt by `source_staging_id` and returns it unchanged.
 */
export const receiptLoader: RecordLoader<GroceryReceiptV1> = {
  targetKeys: ['grocery.receipt@1'],
  async load(client, receipt, record) {
    const db = drizzle(client);
    const [existing] = await db
      .select({ id: receipts.id })
      .from(receipts)
      .where(sql`${receipts.sourceStagingId} = ${record.recordId}`);
    if (existing) return existing.id;

    const [merchant] = await db
      .insert(merchants)
      .values({
        merchantKey: merchantKey(receipt.merchant),
        name: receipt.merchant.name.trim(),
        vatNumber: receipt.merchant.vatNumber ?? null,
        address: receipt.merchant.address ?? null,
      })
      .onConflictDoUpdate({
        target: merchants.merchantKey,
        // The newest receipt knows the shop best; keep what it does not say.
        set: {
          name: sql`excluded.name`,
          address: sql`coalesce(excluded.address, ${merchants.address})`,
          updatedAt: new Date(),
        },
      })
      .returning({ id: merchants.id });

    const [saved] = await db
      .insert(receipts)
      .values({
        sourceStagingId: record.recordId,
        uploadId: record.uploadId,
        merchantId: merchant.id,
        purchasedAt: new Date(receipt.purchasedAt),
        currency: receipt.currency.toUpperCase(),
        total: receipt.total,
        paymentMethod: receipt.paymentMethod ?? null,
        documentFields: record.documentFields ?? null,
        approvedAt: new Date(record.approvedAt),
      })
      .returning({ id: receipts.id });
    if (receipt.items.length)
      await db.insert(receiptItems).values(
        receipt.items.map((item, position) => ({
          receiptId: saved.id,
          position,
          rawName: item.rawName,
          normalizedName: item.normalizedName,
          category: item.category,
          quantity: item.quantity,
          unitPrice: item.unitPrice ?? null,
          lineTotal: item.lineTotal,
        })),
      );
    return saved.id;
  },
};
