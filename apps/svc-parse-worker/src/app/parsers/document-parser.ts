import type {
  CategoryTemplate,
  DocumentAnalysis,
  ExtractedFields,
  ProviderErrorDetails,
} from '@life-island/contracts';
import type { NormalizedDocument } from '../normalize.js';
import type { ExtractionPlan } from '../templates.js';

export interface ParseInput {
  document: NormalizedDocument;
  filename: string;
  /** What the person typed when uploading; a strong hint for the classifier. */
  title: string;
  description: string | null;
}

/** One model call, stored in `ingestion.parse_runs`. */
export interface ParseRunRecord {
  step: 'classify' | 'extract' | 'correct' | 'discover';
  model: string;
  promptVersion: string;
  inputTokens?: number;
  outputTokens?: number;
  latencyMs?: number;
  rawOutput?: unknown;
  error?: string;
}

/** A category as the analyzer sees it: id, meaning and template. */
export interface CategoryDefinition {
  id: string;
  title: string;
  description: string;
  template: CategoryTemplate;
}

/** A category the analyzer thinks is missing from the table. */
export interface ProposedCategory extends CategoryDefinition {
  reason: string;
}

export interface Classification {
  analysis: DocumentAnalysis;
  /** Ids of existing categories that apply. */
  categoryIds: string[];
  /** Where the details go for review (`grocery.receipt@1`...). */
  targetKey: string;
  /** Module of the target, e.g. `groceries`. */
  category: string;
  /** Suggested description, used only when the person left it empty. */
  description?: string;
  flags: string[];
}

export interface Extraction {
  /** Data shaped by the target schema, for the review inbox. */
  details: unknown;
  /** Fields from the templates of the assigned categories. */
  fields: ExtractedFields;
  flags: string[];
}

export interface Discovery {
  suggestions: ProposedCategory[];
}

export interface DiscoveryContext {
  categories: CategoryDefinition[];
  /** Suggestions waiting for approval: reuse their ids instead of inventing near-duplicates. */
  pending: CategoryDefinition[];
  /** Ids you rejected; never propose them again. */
  rejectedIds: string[];
  analysis: DocumentAnalysis;
  assignedIds: string[];
}

/** A step's result plus the model calls it made. */
export interface StepOutput<T> {
  result: T;
  runs: ParseRunRecord[];
}

/**
 * Reads a document in three independent steps, so the worker can save each
 * result before starting the next and resume an interrupted document where
 * it stopped. Every step must base its answer on the document only.
 */
export interface DocumentAnalyzer {
  readonly name: string;
  classify(
    input: ParseInput,
    categories: CategoryDefinition[],
  ): Promise<StepOutput<Classification>>;
  extract(
    input: ParseInput,
    plan: ExtractionPlan,
  ): Promise<StepOutput<Extraction>>;
  discover(
    input: ParseInput,
    context: DiscoveryContext,
  ): Promise<StepOutput<Discovery>>;
}

/** Base of the errors a step can throw; `runs` are the calls made before it failed. */
export class ParseStepError extends Error {
  runs: ParseRunRecord[] = [];
}

/**
 * Retrying cannot help (the model declined the document, the file is
 * unreadable or too large): the upload goes straight to FAILED. Errors that are
 * not a ParseStepError are retried with backoff until the attempts run out.
 */
export class PermanentParseError extends ParseStepError {}

/**
 * The provider's total usage quota is exhausted (credit balance, spend limit).
 * Nothing will work until it is replenished: the whole queue pauses.
 */
export class QuotaExhaustedError extends ParseStepError {
  constructor(
    message: string,
    readonly details: ProviderErrorDetails,
    /** When the provider says usage is available again, if it says so. */
    readonly resetAt: Date | null = null,
  ) {
    super(message);
  }
}

/** A short-term request or token rate limit; the queue waits for the provider's retry time. */
export class RateLimitedError extends ParseStepError {
  constructor(
    message: string,
    readonly details: ProviderErrorDetails,
    /** From `retry-after` or the rate-limit reset headers; null when not given. */
    readonly retryAt: Date | null = null,
  ) {
    super(message);
  }
}

/** The API key is missing, invalid or not allowed: every document would fail the same way. */
export class CredentialsError extends ParseStepError {
  constructor(
    message: string,
    readonly details: ProviderErrorDetails,
  ) {
    super(message);
  }
}

/** One request is larger than the model's context window: split the document. */
export class ContextTooLargeError extends ParseStepError {}
