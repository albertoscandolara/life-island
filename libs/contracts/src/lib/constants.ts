/*
 * Plain constants with no dependencies, safe to import from the browser
 * (`@life-island/contracts/constants`) without pulling Zod into a bundle.
 */

export const FILE_FORMATS = [
  'JPG',
  'PNG',
  'WEBP',
  'PDF',
  'XLSX',
  'CSV',
  'DOCX',
  'TXT',
] as const;
export type FileFormat = (typeof FILE_FORMATS)[number];

/** MIME types for each format; the first entry is the canonical one. */
export const FILE_FORMAT_MIME_TYPES: Record<FileFormat, readonly string[]> = {
  JPG: ['image/jpeg'],
  PNG: ['image/png'],
  WEBP: ['image/webp'],
  PDF: ['application/pdf'],
  XLSX: ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
  CSV: ['text/csv', 'application/csv'],
  DOCX: [
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  ],
  TXT: ['text/plain'],
};

export const FILE_FORMAT_EXTENSIONS: Record<FileFormat, readonly string[]> = {
  JPG: ['jpg', 'jpeg'],
  PNG: ['png'],
  WEBP: ['webp'],
  PDF: ['pdf'],
  XLSX: ['xlsx'],
  CSV: ['csv'],
  DOCX: ['docx'],
  TXT: ['txt'],
};

/** Value for a file input's `accept` attribute covering every supported format. */
export const ACCEPTED_FILE_TYPES = FILE_FORMATS.flatMap((format) => [
  ...FILE_FORMAT_EXTENSIONS[format].map((extension) => `.${extension}`),
  ...FILE_FORMAT_MIME_TYPES[format],
]).join(',');

export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;
export const TITLE_MAX_LENGTH = 200;
export const DESCRIPTION_MAX_LENGTH = 255;

/** Lifecycle of a file in the ingestion service. */
export const UPLOAD_STATUSES = [
  'UPLOADING', // row created, the browser is sending the file to storage
  'TO_BE_PARSED', // file stored and verified, waiting for the daily parse run
  'PARSING', // claimed by the parse worker
  'PARSED', // classified and extracted; categories and details are filled
  'FAILED', // rejected file, or parsing failed after every attempt
] as const;
export type UploadStatus = (typeof UPLOAD_STATUSES)[number];

/**
 * Formats a browser can show inline, so the loader offers an in-page preview;
 * the others (Word, Excel) can only be downloaded.
 */
export const PREVIEWABLE_FORMATS: readonly FileFormat[] = [
  'JPG',
  'PNG',
  'WEBP',
  'PDF',
  'CSV',
  'TXT',
];

/** Lifecycle of a record in the review inbox (a superset of the upload lifecycle). */
export const RECORD_STATUSES = [
  'UPLOADED',
  'PARSING',
  'PARSED', // waiting for your review
  'PARSE_FAILED',
  'CONFIRMED', // you confirmed it; the domain service is loading it
  'LOADED', // the domain service stored it in its own table
  'LOAD_FAILED',
] as const;
export type RecordStatus = (typeof RECORD_STATUSES)[number];

/** Statuses from which a record can be confirmed (LOAD_FAILED allows a retry). */
export const CONFIRMABLE_STATUSES: readonly RecordStatus[] = [
  'PARSED',
  'LOAD_FAILED',
];

/** Categories a record can belong to, i.e. the module whose tables receive it. */
export const CATEGORY_LABELS: Record<string, string> = {
  groceries: 'Groceries',
  tax730: '730 tax return',
  other: 'Other',
};
