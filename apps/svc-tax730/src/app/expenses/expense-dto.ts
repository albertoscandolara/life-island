import type { ExpenseDto } from '@life-island/contracts';
import type { ExpenseRow } from '../db/schema.js';

export function toExpenseDto(row: ExpenseRow): ExpenseDto {
  return {
    id: row.id,
    sourceStagingId: row.sourceStagingId,
    uploadId: row.uploadId,
    taxYear: row.taxYear,
    expenseType: row.expenseType as ExpenseDto['expenseType'],
    frame730: row.frame730,
    date: row.date,
    amount: row.amount,
    beneficiaryFiscalCode: row.beneficiaryFiscalCode,
    traceablePayment: row.traceablePayment,
    issuer: row.issuer,
    documentNumber: row.documentNumber,
    description: row.description,
    notes: row.notes,
  };
}
