import type { Tax730DocumentDto } from '@life-island/contracts';
import type { DocumentRow } from '../db/schema.js';

type Fields = Record<string, string | number | boolean | null>;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}/;

/**
 * The document's main date: the first date-like field (issue_date,
 * payment_date, date...) that holds an ISO date. Templates differ per
 * category, so it goes by the field's name and value.
 */
export function documentDate(fields: Fields | null | undefined): string | null {
  if (!fields) return null;
  const entries = Object.entries(fields);
  const preferred = ['issue_date', 'document_date', 'payment_date', 'date'];
  for (const key of preferred) {
    const value = fields[key];
    if (typeof value === 'string' && ISO_DATE.test(value))
      return value.slice(0, 10);
  }
  for (const [key, value] of entries) {
    if (
      /date|data/.test(key) &&
      typeof value === 'string' &&
      ISO_DATE.test(value)
    )
      return value.slice(0, 10);
  }
  return null;
}

/** The document's main amount: `total_amount`, else the first amount-like number. */
export function documentAmount(
  fields: Fields | null | undefined,
): number | null {
  if (!fields) return null;
  const toNumber = (value: unknown) =>
    typeof value === 'number'
      ? value
      : typeof value === 'string' && /^-?\d+([.,]\d+)?$/.test(value.trim())
        ? Number(value.trim().replace(',', '.'))
        : null;
  const total = toNumber(fields['total_amount']);
  if (total !== null) return total;
  for (const [key, value] of Object.entries(fields)) {
    if (!/amount|total|importo/.test(key)) continue;
    const number = toNumber(value);
    if (number !== null) return number;
  }
  return null;
}

export function toDocumentDto(row: DocumentRow): Tax730DocumentDto {
  return {
    uploadId: row.uploadId,
    title: row.title,
    originalFilename: row.originalFilename,
    fileFormat: row.fileFormat,
    categories: row.categories,
    date: documentDate(row.fields),
    amount: documentAmount(row.fields),
    uploadedAt: row.uploadedAt.toISOString(),
    deleted: row.deletedAt !== null,
  };
}
