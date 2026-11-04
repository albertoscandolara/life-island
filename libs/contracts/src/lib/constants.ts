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
  'PAUSED_QUOTA', // the AI usage quota ran out mid-document; resumes when it is back
  'PAUSED_RATE_LIMIT', // the AI provider asked to slow down; resumes after its retry time
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
  'PARTIALLY_PARSED', // some parse steps are saved, the rest will run on a later attempt
  'PAUSED_QUOTA', // parsing paused: the AI usage quota is exhausted
  'PAUSED_RATE_LIMIT', // parsing paused: the AI provider rate-limited the worker
  'PARSED', // waiting for your review
  'PARSE_FAILED',
  'CONFIRMED', // you confirmed it; the domain service is loading it
  'LOADED', // the domain service stored it in its own table
  'LOAD_FAILED',
  'REJECTED', // you rejected it: nothing is sent to a module; reopen it to review again
] as const;
export type RecordStatus = (typeof RECORD_STATUSES)[number];

/** Statuses from which a record can be confirmed (LOAD_FAILED allows a retry). */
export const CONFIRMABLE_STATUSES: readonly RecordStatus[] = [
  'PARSED',
  'LOAD_FAILED',
];

/** Statuses from which a record can be rejected: anything not yet handed to a module. */
export const REJECTABLE_STATUSES: readonly RecordStatus[] = [
  'UPLOADED',
  'PARTIALLY_PARSED',
  'PAUSED_QUOTA',
  'PAUSED_RATE_LIMIT',
  'PARSED',
  'PARSE_FAILED',
  'LOAD_FAILED',
];

/**
 * The modules a record can be sent to (a record's `category` field, not to be
 * confused with document categories). `other` has no module: a confirmed
 * record of it stays with the document.
 */
export const MODULE_LABELS: Record<string, string> = {
  groceries: 'Groceries',
  tax730: '730 tax return',
  other: 'Documents only',
};
/** Modules that load confirmed records into their own tables. */
export const LOADING_MODULES: readonly string[] = ['groceries', 'tax730'];

/**
 * The steps the parse worker runs on each document, in order. Each step's
 * result is saved as soon as it finishes, so an interrupted document resumes
 * at the first step that is not in its `completed_steps`.
 */
export const PARSE_STEPS = [
  'CLASSIFY', // type, purpose, existing categories, target
  'DISCOVER', // new categories worth suggesting
  'EXTRACT', // fields from the templates of the assigned and suggested categories
] as const;
export type ParseStep = (typeof PARSE_STEPS)[number];

/** State of the parse queue as a whole (one row in `ingestion.parse_queue`). */
export const PARSE_QUEUE_STATUSES = [
  'IDLE', // waiting for the next scheduled run
  'RUNNING', // a run is processing documents
  'PAUSED_QUOTA', // the AI usage quota is exhausted: no AI requests until it is back
  'PAUSED_RATE_LIMIT', // rate-limited: no AI requests until the provider's retry time
  'BLOCKED_CREDENTIALS', // the API key was refused: no AI requests until it is fixed
] as const;
export type ParseQueueStatus = (typeof PARSE_QUEUE_STATUSES)[number];

/**
 * What the review UI shows about a document's processing, derived from its
 * status and completed steps.
 */
export const PROCESSING_STATES = [
  'UPLOADING',
  'PENDING', // waiting for the next run
  'PROCESSING',
  'PARTIAL', // some steps saved, the rest still to do
  'PAUSED_QUOTA',
  'PAUSED_RATE_LIMIT',
  'PROCESSED',
  'FAILED',
] as const;
export type ProcessingState = (typeof PROCESSING_STATES)[number];

/** Review state of an AI-suggested category. */
export const SUGGESTION_STATUSES = ['PENDING', 'APPROVED', 'REJECTED'] as const;
export type SuggestionStatus = (typeof SUGGESTION_STATUSES)[number];

/** How an extracted template field turned out. Only `found` carries a value. */
export const FIELD_STATUSES = [
  'found',
  'missing', // the document does not contain it
  'illegible', // it is there but cannot be read reliably
  'ambiguous', // several readings are possible
  'conflicting', // the document states different values
  'invalid', // a value was read but does not match the field type
] as const;
export type FieldStatus = (typeof FIELD_STATUSES)[number];

/** Field types a category template can declare. */
export const TEMPLATE_FIELD_TYPES = [
  'string',
  'text',
  'number',
  'integer',
  'amount', // a money amount: a number with at most two decimals
  'currency', // ISO 4217 code, e.g. EUR
  'date', // YYYY-MM-DD
  'datetime', // ISO 8601 date and time
  'period', // YYYY-MM-DD/YYYY-MM-DD
  'boolean',
  'enum', // one of `options`
] as const;
export type TemplateFieldType = (typeof TEMPLATE_FIELD_TYPES)[number];

/**
 * Independent metadata dimensions a category can belong to. A category with
 * no dimension is a general one (all categories created before dimensions
 * existed start that way). Parents and children always share a dimension, so
 * document types, subjects, properties and the rest never mix in one tree.
 */
export const CATEGORY_DIMENSIONS = [
  'DOCUMENT_TYPE', // what the document is: INVOICE, RECEIPT, BILL...
  'SUBJECT', // what it concerns: HOME, MEDICAL, VEHICLE...
  'PROPERTY', // the property or location it refers to: TREGNAGO...
  'PERSON', // who it concerns: ME, SPOUSE, CHILD...
  'ISSUER', // who issued it: AMAZON, ENEL, INPS...
  'ATTRIBUTE', // independent traits: TAX_DEDUCTIBLE, PAID, RECURRING...
] as const;
export type CategoryDimension = (typeof CATEGORY_DIMENSIONS)[number];

export const CATEGORY_DIMENSION_LABELS: Record<CategoryDimension, string> = {
  DOCUMENT_TYPE: 'Document type',
  SUBJECT: 'Subject',
  PROPERTY: 'Property / location',
  PERSON: 'Person',
  ISSUER: 'Issuer / supplier',
  ATTRIBUTE: 'Attribute',
};

/**
 * Dimensions a document has at most one of: one primary document type and
 * one issuer. A category and its ancestors count as one (an
 * ELECTRICITY_BILL is also a BILL), so only unrelated ones conflict. Every
 * dimension is optional.
 */
export const SINGLE_VALUED_DIMENSIONS: readonly CategoryDimension[] = [
  'DOCUMENT_TYPE',
  'ISSUER',
];

/** What happens to the subcategories of a category you delete. */
export const DELETE_CHILDREN_OPTIONS = [
  'MOVE_TO_PARENT', // they take the deleted category's place (top level if it had no parent)
  'MAKE_ROOT', // they become top-level categories
] as const;
export type DeleteChildrenOption = (typeof DELETE_CHILDREN_OPTIONS)[number];

/** What happens to the documents of a category you delete. Documents themselves are never deleted. */
export const DELETE_DOCUMENTS_OPTIONS = [
  'REMOVE', // the category is taken off them
  'MOVE_TO_PARENT', // they get the parent category instead
] as const;
export type DeleteDocumentsOption = (typeof DELETE_DOCUMENTS_OPTIONS)[number];

/**
 * Where a document stands in the historical reclassification, on top of its
 * normal status (which never changes because of it). Null on the document
 * means "normal": not being checked and nothing to review.
 */
export const HISTORICAL_STATUSES = [
  'RECLASSIFYING', // a reclassification run is checking it against newer categories
  'PENDING_REVIEW', // newer categories may apply: waiting for your decision
] as const;
export type HistoricalStatus = (typeof HISTORICAL_STATUSES)[number];

/** A reclassification run (the job), as opposed to a document's state. */
export const RECLASSIFICATION_RUN_STATUSES = [
  'RUNNING', // holds the global lock: documents and categories are read-only
  'COMPLETED',
  'FAILED', // stopped by an error it could not get past
  'INTERRUPTED', // stopped early (AI quota, crash, shutdown); the next run resumes
  'BLOCKED', // could not start: see its blocked reasons; nothing was changed
] as const;
export type ReclassificationRunStatus =
  (typeof RECLASSIFICATION_RUN_STATUSES)[number];

export const RECLASSIFICATION_TRIGGERS = [
  'MANUAL', // Reclassify now
  'SCHEDULED', // the monthly schedule
] as const;
export type ReclassificationTrigger =
  (typeof RECLASSIFICATION_TRIGGERS)[number];

/** Why a reclassification run cannot start. */
export const RECLASSIFICATION_BLOCK_REASONS = [
  'PENDING_SUGGESTIONS', // suggested categories wait for a decision
  'PARSING_RUNNING', // the initial parser is working
  'ALREADY_RUNNING', // another reclassification holds the lock
  'AI_PAUSED', // the AI quota or rate limit paused processing
] as const;
export type ReclassificationBlockReason =
  (typeof RECLASSIFICATION_BLOCK_REASONS)[number];

/** The `code` of a 423 answer while a reclassification holds the lock. */
export const RECLASSIFICATION_LOCKED_CODE = 'RECLASSIFICATION_RUNNING';
