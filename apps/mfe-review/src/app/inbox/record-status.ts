import type { RecordStatus } from '@life-island/contracts';
import type { UiTone } from '@life-island/design-system';

export interface StatusView {
  label: string;
  tone: UiTone;
  pulse?: boolean;
}

export const RECORD_STATUS_VIEW: Record<RecordStatus, StatusView> = {
  UPLOADED: { label: 'Uploaded', tone: 'neutral' },
  PARSING: { label: 'Parsing', tone: 'progress', pulse: true },
  PARSED: { label: 'Parsed, to review', tone: 'warning' },
  PARSE_FAILED: { label: 'Parsing failed', tone: 'danger' },
  CONFIRMED: { label: 'Confirmed', tone: 'info' },
  LOADED: { label: 'Loaded', tone: 'success' },
  LOAD_FAILED: { label: 'Loading failed', tone: 'danger' },
};

/** Statuses whose records have extracted details to look at. */
export const HAS_DETAILS: readonly RecordStatus[] = [
  'PARSED',
  'CONFIRMED',
  'LOADED',
  'LOAD_FAILED',
];
