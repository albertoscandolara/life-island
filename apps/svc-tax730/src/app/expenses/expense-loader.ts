import { LoadRejectedError, type RecordLoader } from '@life-island/be-common';
import type { Tax730ExpenseV1 } from '@life-island/contracts';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { expenses, taxYears } from '../db/schema.js';

/** A codice fiscale: 16 characters, letters and digits in the official pattern. */
const FISCAL_CODE =
  /^[A-Z]{6}[0-9LMNPQRSTUV]{2}[A-Z][0-9LMNPQRSTUV]{2}[A-Z][0-9LMNPQRSTUV]{3}[A-Z]$/;

/**
 * Loads a confirmed `tax730.expense@1` into its tax year. A replay of the
 * same review record returns the expense already stored.
 */
export const expenseLoader: RecordLoader<Tax730ExpenseV1> = {
  targetKeys: ['tax730.expense@1'],
  async load(client, expense, record) {
    const db = drizzle(client);
    const [existing] = await db
      .select({ id: expenses.id })
      .from(expenses)
      .where(eq(expenses.sourceStagingId, record.recordId));
    if (existing) return existing.id;

    const fiscalCode = expense.beneficiaryFiscalCode
      ?.replace(/\s/g, '')
      .toUpperCase();
    if (fiscalCode && !FISCAL_CODE.test(fiscalCode))
      throw new LoadRejectedError(
        `beneficiaryFiscalCode: ${expense.beneficiaryFiscalCode} is not a valid codice fiscale`,
      );
    if (expense.amount <= 0)
      throw new LoadRejectedError('amount: a deductible expense is positive');

    await db
      .insert(taxYears)
      .values({ taxYear: expense.taxYear })
      .onConflictDoNothing();
    const [saved] = await db
      .insert(expenses)
      .values({
        sourceStagingId: record.recordId,
        uploadId: record.uploadId,
        taxYear: expense.taxYear,
        expenseType: expense.expenseType,
        frame730: expense.frame730 ?? null,
        date: expense.date,
        amount: expense.amount,
        beneficiaryFiscalCode: fiscalCode ?? null,
        traceablePayment: expense.traceablePayment ?? null,
        issuer: expense.issuer,
        documentNumber: expense.documentNumber ?? null,
        documentFields: record.documentFields ?? null,
        approvedAt: new Date(record.approvedAt),
      })
      .returning({ id: expenses.id });
    return saved.id;
  },
};
