import type { ProcessingState, RecordStatus } from '@life-island/contracts';
import type { UiTone } from '@life-island/design-system';

export interface StatusView {
  label: string;
  tone: UiTone;
  pulse?: boolean;
}

export const RECORD_STATUS_VIEW: Record<RecordStatus, StatusView> = {
  UPLOADED: { label: 'Uploaded', tone: 'neutral' },
  PARSING: { label: 'Parsing', tone: 'progress', pulse: true },
  PARTIALLY_PARSED: { label: 'Partially parsed', tone: 'info' },
  PAUSED_QUOTA: { label: 'Paused: AI quota exhausted', tone: 'warning' },
  PAUSED_RATE_LIMIT: { label: 'Paused: rate limit', tone: 'warning' },
  PARSED: { label: 'Parsed, to review', tone: 'warning' },
  PARSE_FAILED: { label: 'Parsing failed', tone: 'danger' },
  CONFIRMED: { label: 'Confirmed', tone: 'info' },
  LOADED: { label: 'Loaded', tone: 'success' },
  LOAD_FAILED: { label: 'Loading failed', tone: 'danger' },
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
