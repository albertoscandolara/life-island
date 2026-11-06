import type {
  HistoricalStatus,
  ProcessingState,
  RecordStatus,
} from '@life-island/contracts';
import type { UiTone } from '@life-island/design-system';

/**
 * Records you can send back to the parser: read but not confirmed yet, or
 * whose reading failed (after you fixed what made it fail, such as the parser
 * or its API key).
 */
export function canReparse(record: { status: RecordStatus }): boolean {
  return record.status === 'PARSED' || record.status === 'PARSE_FAILED';
}

export interface StatusView {
  label: string;
  tone: UiTone;
  pulse?: boolean;
}

export const RECORD_STATUS_VIEW: Record<RecordStatus, StatusView> = {
  UPLOADED: { label: 'Uploaded, to parse', tone: 'neutral' },
  PARSING: { label: 'Parsing', tone: 'progress', pulse: true },
  PARTIALLY_PARSED: { label: 'Partially parsed', tone: 'info' },
  PAUSED_QUOTA: { label: 'Paused: AI quota exhausted', tone: 'warning' },
  PAUSED_RATE_LIMIT: { label: 'Paused: rate limit', tone: 'warning' },
  PARSED: { label: 'Parsed, to review', tone: 'warning' },
  PARSE_FAILED: { label: 'Parsing failed', tone: 'danger' },
  CONFIRMED: { label: 'Confirmed, sending', tone: 'info', pulse: true },
  LOADED: { label: 'In its module', tone: 'success' },
  LOAD_FAILED: { label: 'Module refused it', tone: 'danger' },
  REJECTED: { label: 'Rejected', tone: 'neutral' },
};

/** How a document's AI processing is shown (the loader and the details popup). */
export const PROCESSING_VIEW: Record<ProcessingState, StatusView> = {
  UPLOADING: { label: 'Uploading', tone: 'info' },
  PENDING: { label: 'Pending processing', tone: 'neutral' },
  PROCESSING: { label: 'Processing', tone: 'progress', pulse: true },
  PARTIAL: { label: 'Partially processed', tone: 'info' },
  PAUSED_QUOTA: { label: 'Paused: AI quota exhausted', tone: 'warning' },
  PAUSED_RATE_LIMIT: { label: 'Paused: rate limit', tone: 'warning' },
  PROCESSED: { label: 'Processed', tone: 'success' },
  FAILED: { label: 'Failed', tone: 'danger' },
};

export const STEP_LABELS = {
  CLASSIFY: 'Classify and match categories',
  EXTRACT: 'Extract template fields',
  DISCOVER: 'Suggest new categories',
} as const;

/** The historical reclassification overlay, shown next to the normal status. */
export const HISTORICAL_STATUS_VIEW: Record<HistoricalStatus, StatusView> = {
  RECLASSIFYING: {
    label: 'Checking new categories',
    tone: 'progress',
    pulse: true,
  },
  PENDING_REVIEW: { label: 'New categories to review', tone: 'warning' },
};
