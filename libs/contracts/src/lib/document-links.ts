import { z } from 'zod';

/**
 * Invoices and the payments that settle them. The parse worker reads the
 * money facts of every document from its content (never from the file name),
 * and a matcher links each payment to the invoices and quotes it pays. Links
 * live in svc-ingestion (`ingestion.document_links`), next to the documents.
 */

/**
 * What a document is in a money transaction:
 * - INVOICE: asks to be paid (invoice, bill, fee note, receipt to pay).
 * - QUOTE: announces what will be asked (quote, estimate, pro-forma). A
 *   payment often names the quote, so it links to the quote and the invoice.
 * - PAYMENT: proves money moved (bank transfer, card slip, direct debit, F24).
 * - NONE: anything else; it is never matched.
 */
export const TRANSACTION_ROLES = [
  'INVOICE',
  'QUOTE',
  'PAYMENT',
  'NONE',
] as const;
export type TransactionRole = (typeof TRANSACTION_ROLES)[number];

/** What part of the amount a payment says it settles, as its description puts it. */
export const PAYMENT_KINDS = [
  'FULL',
  'ADVANCE', // acconto, anticipo, caparra
  'BALANCE', // saldo
  'PARTIAL',
  'INSTALLMENT', // rata
  'UNKNOWN',
] as const;
export type PaymentKind = (typeof PAYMENT_KINDS)[number];

/**
 * How a link was decided:
 * - AUTO: the evidence was clear and nothing else competed; set by the matcher.
 * - SUGGESTED: a possible match that needs your check (weak evidence, or
 *   several invoices could fit the same payment).
 * - CONFIRMED: you linked or confirmed it; the matcher never changes it.
 * - REJECTED: you said they do not belong together; never proposed again.
 */
export const DOCUMENT_LINK_STATUSES = [
  'AUTO',
  'SUGGESTED',
  'CONFIRMED',
  'REJECTED',
] as const;
export type DocumentLinkStatus = (typeof DOCUMENT_LINK_STATUSES)[number];

const isoDay = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'a date as YYYY-MM-DD')
  .nullable();

export const transactionPartySchema = z.object({
  name: z.string().nullable().describe('The name as printed; null if absent'),
  vatNumber: z
    .string()
    .nullable()
    .describe('VAT number (Partita IVA), as printed'),
  taxCode: z
    .string()
    .nullable()
    .describe('Tax code (Codice Fiscale), as printed'),
  iban: z
    .string()
    .nullable()
    .describe('IBAN of this party, as printed (also in a stamp or footer)'),
});
export type TransactionParty = z.infer<typeof transactionPartySchema>;

export const transactionReferenceSchema = z.object({
  kind: z
    .string()
    .nullable()
    .describe('What is referred to: invoice, quote, contract, order...'),
  number: z.string().nullable().describe('Its number as written, if any'),
  date: isoDay.describe('Its date as YYYY-MM-DD, if written'),
});
export type TransactionReference = z.infer<typeof transactionReferenceSchema>;

/**
 * The money facts of one document, read from its content. For an invoice or
 * quote the counterparty is the supplier who issued it and the customer who
 * it is addressed to; for a payment the counterparty is the beneficiary who
 * received the money and the customer the payer (ordinante).
 */
export const transactionFactsSchema = z.object({
  role: z.enum(TRANSACTION_ROLES),
  documentKind: z
    .string()
    .nullable()
    .describe('In a few words: "invoice", "quote", "SEPA bank transfer"...'),
  documentNumber: z
    .string()
    .nullable()
    .describe(
      'The invoice or quote number; for a payment its transaction id (CRO, TRN)',
    ),
  issueDate: isoDay.describe('When it was issued or the order was entered'),
  dueDate: isoDay.describe('When an invoice must be paid'),
  paymentDate: isoDay.describe(
    'When a payment was executed or debited; null for an invoice',
  ),
  amount: z
    .number()
    .nullable()
    .describe(
      'Invoice or quote: the total to pay. Payment: the amount transferred, without fees',
    ),
  fees: z.number().nullable().describe('Bank fees charged on a payment'),
  currency: z.string().nullable().describe('ISO 4217 code, e.g. EUR'),
  counterparty: transactionPartySchema,
  customer: transactionPartySchema,
  references: z
    .array(transactionReferenceSchema)
    .describe(
      'Other documents it names: in a payment description the invoices, quotes or contracts it pays',
    ),
  paymentKind: z.enum(PAYMENT_KINDS).nullable(),
  description: z
    .string()
    .nullable()
    .describe(
      'Payment: the description (causale) verbatim. Invoice: its subject (oggetto) and what it charges for, in one line',
    ),
  subjects: z
    .array(z.string())
    .describe(
      'What it concerns, as written: property addresses, cadastral data, contract or customer numbers, plates, project names',
    ),
});
export type TransactionFacts = z.infer<typeof transactionFactsSchema>;

/** A document on the other side of a link, enough to recognise it. */
export interface LinkedDocumentDto {
  uploadId: string;
  title: string;
  originalFilename: string;
  role: TransactionRole;
  documentKind: string | null;
  documentNumber: string | null;
  /** Issue date of an invoice or quote; execution date of a payment. */
  date: string | null;
  amount: number | null;
  currency: string | null;
  /** Supplier of an invoice; beneficiary of a payment. */
  counterparty: string | null;
}

export interface DocumentLinkDto {
  id: string;
  /** The invoice or quote. */
  invoiceUploadId: string;
  paymentUploadId: string;
  status: DocumentLinkStatus;
  /** The matcher's score; higher is stronger evidence. */
  score: number;
  /** What ties the two documents together, in plain words. */
  reasons: string[];
  createdAt: string;
  updatedAt: string;
  /** When you confirmed, linked or rejected it; null for the matcher's own links. */
  decidedAt: string | null;
  invoice: LinkedDocumentDto;
  payment: LinkedDocumentDto;
}

/** A document's money facts and its links, for its review panel. */
export interface DocumentLinksDto {
  uploadId: string;
  /** Null until the AI has read the money facts (right after parsing). */
  facts: TransactionFacts | null;
  /** Every link except the rejected ones, strongest first. */
  links: DocumentLinkDto[];
  /**
   * For an invoice: how much the linked payments (AUTO and CONFIRMED) add up
   * to. For a payment: how much the linked invoices add up to. Null when no
   * amounts are known.
   */
  linkedTotal: number | null;
}

/** A document you could link by hand, with how the matcher rates the pair. */
export interface LinkCandidateDto {
  document: LinkedDocumentDto;
  score: number;
  reasons: string[];
}

export const listDocumentLinksQuerySchema = z.object({
  status: z.enum(DOCUMENT_LINK_STATUSES).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});
export type ListDocumentLinksQuery = z.input<
  typeof listDocumentLinksQuerySchema
>;

/** Link two documents by hand: one invoice or quote, one payment. */
export const createDocumentLinkRequestSchema = z.object({
  invoiceUploadId: z.uuid(),
  paymentUploadId: z.uuid(),
});
export type CreateDocumentLinkRequest = z.input<
  typeof createDocumentLinkRequestSchema
>;
