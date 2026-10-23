import type { NormalizedDocument } from '../normalize.js';

export interface ParseInput {
  document: NormalizedDocument;
  filename: string;
  /** What the person typed when uploading; a strong hint for the classifier. */
  title: string;
  description: string | null;
}

/** One model call, stored in `ingestion.parse_runs`. */
export interface ParseRunRecord {
  step: 'classify' | 'extract' | 'correct';
  model: string;
  promptVersion: string;
  inputTokens?: number;
  outputTokens?: number;
  latencyMs?: number;
  rawOutput?: unknown;
  error?: string;
}

export interface ParseResult {
  targetKey: string;
  category: string;
  /** Suggested description, used only when the person left it empty. */
  description?: string;
  details: unknown;
  confidence: number;
  /** e.g. `low_confidence`, `needs_attention`; shown in the review inbox. */
  flags: string[];
  runs: ParseRunRecord[];
}

/**
 * Thrown when retrying cannot help (the model declined the document, the file
 * is unreadable): the upload goes straight to FAILED. Any other error is
 * retried with backoff until the attempts run out.
 */
export class PermanentParseError extends Error {}

export interface DocumentParser {
  readonly name: string;
  parse(input: ParseInput): Promise<ParseResult>;
}
