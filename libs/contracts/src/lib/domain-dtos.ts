import { z } from 'zod';
import { TAX730_EXPENSE_TYPES } from './targets/tax730-expense.js';

/*
 * HTTP DTOs of the domain services (svc-groceries, svc-tax730): what each
 * module serves about the records it loaded.
 */

const pageQuery = {
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
};

// ---------------------------------------------------------------------------
// Groceries

export const listReceiptsQuerySchema = z.object({
  from: z.iso.date().optional(),
  to: z.iso.date().optional(),
  merchantId: z.uuid().optional(),
  ...pageQuery,
});
export type ListReceiptsQuery = z.input<typeof listReceiptsQuerySchema>;

export interface MerchantDto {
  id: string;
  name: string;
  vatNumber: string | null;
  address: string | null;
}

export interface ReceiptItemDto {
  position: number;
  rawName: string;
  normalizedName: string;
  category: string;
  quantity: number;
  unitPrice: number | null;
  lineTotal: number;
}

export interface ReceiptDto {
  id: string;
  /** The review record it was confirmed from. */
  sourceStagingId: string;
  uploadId: string;
  merchant: MerchantDto;
  purchasedAt: string;
  currency: string;
  total: number;
  paymentMethod: string | null;
  itemCount: number;
}

export interface ReceiptDetailDto extends ReceiptDto {
  items: ReceiptItemDto[];
  documentFields: Record<string, string | number | boolean | null> | null;
}

/** Spending per item category in a month (`YYYY-MM`). */
export interface SpendingDto {
  month: string;
  category: string;
  total: number;
}

// ---------------------------------------------------------------------------
// 730 tax return

export const listExpensesQuerySchema = z.object({
  taxYear: z.coerce.number().int().min(2000).max(2100).optional(),
  expenseType: z.enum(TAX730_EXPENSE_TYPES).optional(),
  ...pageQuery,
});
export type ListExpensesQuery = z.input<typeof listExpensesQuerySchema>;

export interface ExpenseDto {
  id: string;
  sourceStagingId: string;
  uploadId: string;
  taxYear: number;
  expenseType: (typeof TAX730_EXPENSE_TYPES)[number];
  frame730: string | null;
  date: string;
  amount: number;
  beneficiaryFiscalCode: string | null;
  traceablePayment: boolean | null;
  issuer: string;
  documentNumber: string | null;
}

/** Totals of one tax year, by expense type. */
export interface TaxYearDto {
  taxYear: number;
  total: number;
  expenseCount: number;
  byType: { expenseType: string; total: number; count: number }[];
  /** Expenses not paid traceably (cash): many 730 deductions require card or transfer. */
  untraceableCount: number;
}
