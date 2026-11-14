import { z } from 'zod';
import { TAX730_EXPENSE_TYPES } from './targets/tax730-expense.js';
import type { Tax730DeductionsDto } from './tax730-deductions.js';

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
  /** What the expense was for; null until you or the invoice's title give one. */
  description: string | null;
  notes: string | null;
}

/** Totals of one tax year, by expense type. */
export interface TaxYearDto {
  taxYear: number;
  total: number;
  expenseCount: number;
  byType: { expenseType: string; total: number; count: number }[];
  /** Expenses not paid traceably (cash): many 730 deductions require card or transfer. */
  untraceableCount: number;
  /** The year the 730 is filed: the tax year plus one ("730/2026" covers 2025). */
  filingYear: number;
  /** Expenses with no invoice or no payment proof filed. */
  missingInvoiceCount: number;
  missingPaymentCount: number;
  /** Expenses paired automatically with their payments, waiting for you to confirm the pair. */
  pairsToReviewCount: number;
  /** Estimated tax back, line by line against each kind's cap and rate. */
  deductions: Tax730DeductionsDto;
  /** Spending by month, January first (12 values). */
  byMonth: number[];
}

/** What a document filed for the 730 is: an expense's invoice or payment proof, or a document of the year. */
export const TAX730_ATTACHMENT_ROLES = [
  'INVOICE',
  'PAYMENT',
  'CERTIFICATION',
  'OTHER',
] as const;
export type Tax730AttachmentRole = (typeof TAX730_ATTACHMENT_ROLES)[number];

/** A document you uploaded, as the 730 area sees it. */
export interface Tax730DocumentDto {
  uploadId: string;
  title: string;
  originalFilename: string;
  fileFormat: string | null;
  categories: string[];
  /** The document's main date and amount, read from its fields when it has them. */
  date: string | null;
  amount: number | null;
  uploadedAt: string;
  /** You deleted it in the documents app; the 730 keeps the reference. */
  deleted: boolean;
}

export interface Tax730AttachmentDto {
  uploadId: string;
  role: Tax730AttachmentRole;
  /** Null when the document never reached this service. */
  document: Tax730DocumentDto | null;
  /**
   * Found by the 730 itself (a Certificazione Unica of the year in your
   * documents), not filed by you: there is nothing to remove.
   */
  automatic?: boolean;
}

/** An expense with the documents that prove it. */
/** Whether an expense was read from an invoice or from a payment (a transfer receipt). */
export const TAX730_EXPENSE_KINDS = ['INVOICE', 'PAYMENT'] as const;
export type Tax730ExpenseKind = (typeof TAX730_EXPENSE_KINDS)[number];

/** Your decision on pairing: confirmed, or kept apart; null while automatic. */
export const TAX730_PAIRING_DECISIONS = ['CONFIRMED', 'SEPARATE'] as const;
export type Tax730PairingDecision = (typeof TAX730_PAIRING_DECISIONS)[number];

/** An expense that is the same as another one (a payment of its invoice), so it is not counted again. */
export interface PairedExpenseDto {
  id: string;
  date: string;
  amount: number;
  issuer: string;
  description: string | null;
  kind: Tax730ExpenseKind;
  /** Paired by the 730 area, not confirmed by you yet. */
  automatic: boolean;
}

export interface DossierExpenseDto extends ExpenseDto {
  /** Its documents, with those of the expenses paired with it. */
  attachments: Tax730AttachmentDto[];
  hasInvoice: boolean;
  hasPaymentProof: boolean;
  kind: Tax730ExpenseKind;
  /** Your decision on this expense's own pairing; SEPARATE once you kept it apart. */
  pairing: Tax730PairingDecision | null;
  /** The payments (or second receipts) that are this same expense. Only this one is counted. */
  paired: PairedExpenseDto[];
}

/**
 * Pair an expense with another one (`pairedWith`, it is then counted through
 * that one) or keep it apart (`pairedWith: null`).
 */
export const setExpensePairingRequestSchema = z.object({
  pairedWith: z.uuid().nullable(),
});
export type SetExpensePairingRequest = z.input<
  typeof setExpensePairingRequestSchema
>;

/** Everything that goes into one year's 730: expenses, their documents and the year's own documents. */
export interface TaxYearDossierDto extends TaxYearDto {
  expenses: DossierExpenseDto[];
  /** Documents of the whole year, e.g. the Certificazione Unica. */
  yearDocuments: Tax730AttachmentDto[];
}

/** Edit an expense's description or your note; null clears it. */
export const updateExpenseRequestSchema = z.object({
  description: z.string().trim().max(300).nullable().optional(),
  notes: z.string().trim().max(500).nullable().optional(),
});
export type UpdateExpenseRequest = z.input<typeof updateExpenseRequestSchema>;

/** File a document with an expense (invoice, payment proof) or with a whole year. */
export const addAttachmentRequestSchema = z.object({
  uploadId: z.uuid(),
  role: z.enum(TAX730_ATTACHMENT_ROLES),
});
export type AddAttachmentRequest = z.input<typeof addAttachmentRequestSchema>;

export const listTax730DocumentsQuerySchema = z.object({
  /** Words to find in the title, file name or fields. */
  search: z.string().trim().max(100).optional(),
  /** Rank documents by how likely they prove this expense (amount, supplier, date). */
  forExpense: z.uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
});
export type ListTax730DocumentsQuery = z.input<
  typeof listTax730DocumentsQuerySchema
>;

/** A document, with why it may belong to the expense you are filing. */
export interface Tax730DocumentCandidateDto extends Tax730DocumentDto {
  score: number;
  reasons: string[];
  /** How it is already filed with the expense (or one paired with it); null when it is not. */
  filedAs: Tax730AttachmentRole | null;
}

/** Years to export; none means every year. `year=2025&year=2026` or `year=2025,2026`. */
export const exportQuerySchema = z.object({
  year: z
    .union([z.string(), z.array(z.string())])
    .optional()
    .transform((value) =>
      (value === undefined ? [] : Array.isArray(value) ? value : [value])
        .flatMap((part) => part.split(','))
        .map((part) => part.trim())
        .filter(Boolean)
        .map(Number),
    )
    .pipe(z.array(z.number().int().min(2000).max(2100)).max(20)),
});
export type ExportQuery = z.input<typeof exportQuerySchema>;
