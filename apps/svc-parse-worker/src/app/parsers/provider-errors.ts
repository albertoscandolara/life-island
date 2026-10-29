import Anthropic from '@anthropic-ai/sdk';
import type { ProviderErrorDetails } from '@life-island/contracts';
import {
  ContextTooLargeError,
  CredentialsError,
  PermanentParseError,
  QuotaExhaustedError,
  RateLimitedError,
} from './document-parser.js';

/** Messages the API uses when the organization's usage or credit is used up. */
const QUOTA_MESSAGE =
  /credit balance|usage limit|spend(ing)? limit|quota|insufficient (credit|funds)|billing/i;
const CONTEXT_MESSAGE =
  /prompt is too long|too many (input )?tokens|context (window|length)|maximum context|exceeds the maximum/i;

/** "You will regain access on 2026-11-01 at 00:00 UTC" → that date. */
export function parseQuotaReset(message: string): Date | null {
  const match =
    /regain access on (\d{4}-\d{2}-\d{2})(?: at (\d{1,2}:\d{2}))?\s*(UTC)?/i.exec(
      message,
    );
  if (!match) return null;
  const date = new Date(
    `${match[1]}T${(match[2] ?? '00:00').padStart(5, '0')}:00Z`,
  );
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * When a rate limit lifts: `retry-after` (seconds or an HTTP date) first, else
 * the latest of the `anthropic-ratelimit-*-reset` headers that are exhausted
 * (all of them, if none says which). Null when the response gives no time.
 */
export function rateLimitRetryAt(
  headers: Headers | undefined,
  now = new Date(),
): Date | null {
  if (!headers) return null;
  const retryAfter = headers.get('retry-after');
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds) && seconds >= 0)
      return new Date(now.getTime() + seconds * 1000);
    const date = new Date(retryAfter);
    if (!Number.isNaN(date.getTime())) return date;
  }
  const limits = ['requests', 'tokens', 'input-tokens', 'output-tokens'];
  const resets = limits
    .map((limit) => ({
      remaining: headers.get(`anthropic-ratelimit-${limit}-remaining`),
      reset: headers.get(`anthropic-ratelimit-${limit}-reset`),
    }))
    .filter((entry) => entry.reset);
  const exhausted = resets.filter((entry) => entry.remaining === '0');
  const times = (exhausted.length ? exhausted : resets)
    .map((entry) => new Date(entry.reset!))
    .filter((date) => !Number.isNaN(date.getTime()));
  if (!times.length) return null;
  return new Date(Math.max(...times.map((date) => date.getTime())));
}

function detailsOf(
  error: InstanceType<typeof Anthropic.APIError>,
): ProviderErrorDetails {
  return {
    status: error.status,
    type: error.type ?? undefined,
    message: error.message.slice(0, 1000),
    requestId: error.requestID ?? undefined,
  };
}

/**
 * Sorts an API failure by what can fix it, which decides what the worker does:
 *
 * | Provider says                                  | Error                  | Worker                                   |
 * | ---------------------------------------------- | ---------------------- | ---------------------------------------- |
 * | 402 billing, or any usage/credit limit message | QuotaExhaustedError    | pause the queue until the quota is back  |
 * | 429 rate limit                                 | RateLimitedError       | pause the queue until retry-after        |
 * | 401, 403, 404 (key, permission, model)         | CredentialsError       | stop the run; nothing works until fixed  |
 * | 413, or 400 "prompt is too long"               | ContextTooLargeError   | split the document into chunks           |
 * | other 400 / 422                                | PermanentParseError    | fail this document only                  |
 * | 5xx, 529 overloaded, network errors            | (unchanged)            | retry this document later, with backoff  |
 *
 * The SDK itself already retried 408/409/429/5xx a couple of times, honouring
 * retry-after, before the error gets here.
 */
export function classifyProviderError(error: unknown): unknown {
  if (!(error instanceof Anthropic.APIError) || error.status === undefined)
    return error;
  const { status, message } = error;
  const details = detailsOf(error);
  if (
    status === 402 ||
    error.type === 'billing_error' ||
    ([400, 403, 429].includes(status) && QUOTA_MESSAGE.test(message))
  ) {
    return new QuotaExhaustedError(
      `AI usage quota exhausted: ${message}`,
      details,
      parseQuotaReset(message),
    );
  }
  if (status === 429)
    return new RateLimitedError(
      `Rate-limited by the AI provider: ${message}`,
      details,
      rateLimitRetryAt(error.headers),
    );
  if (status === 401 || status === 403 || status === 404)
    return new CredentialsError(
      `The AI provider refused the request (${status}): ${message}`,
      details,
    );
  if (status === 413 || (status === 400 && CONTEXT_MESSAGE.test(message)))
    return new ContextTooLargeError(message);
  if (status === 400 || status === 422) return new PermanentParseError(message);
  return error;
}
