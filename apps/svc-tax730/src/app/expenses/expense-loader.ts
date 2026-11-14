import { LoadRejectedError, type RecordLoader } from '@life-island/be-common';
import { FISCAL_CODE, type Tax730ExpenseV1 } from '@life-island/contracts';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { attachments, expenses, taxYears } from '../db/schema.js';

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

    // The beneficiary is a person (16 characters). Anything else, such as the
    // supplier's partita IVA read off the invoice, is not who the expense was
    // for: the expense is kept without it, and you can add it by hand.
    const fiscalCode = expense.beneficiaryFiscalCode
      ?.replace(/\s/g, '')
      .toUpperCase();
    const beneficiary =
      fiscalCode && FISCAL_CODE.test(fiscalCode) ? fiscalCode : null;
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
        beneficiaryFiscalCode: beneficiary,
        traceablePayment: expense.traceablePayment ?? null,
        issuer: expense.issuer,
        documentNumber: expense.documentNumber ?? null,
        documentFields: record.documentFields ?? null,
        approvedAt: new Date(record.approvedAt),
      })
      .returning({ id: expenses.id });
    // The document the expense was read from is its invoice.
    await db.insert(attachments).values({
      taxYear: expense.taxYear,
      expenseId: saved.id,
      uploadId: record.uploadId,
      role: 'INVOICE',
    });
    return saved.id;
  },
};
