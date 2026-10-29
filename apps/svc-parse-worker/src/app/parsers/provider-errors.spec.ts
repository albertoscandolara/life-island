import Anthropic from '@anthropic-ai/sdk';
import {
  ContextTooLargeError,
  CredentialsError,
  PermanentParseError,
  QuotaExhaustedError,
  RateLimitedError,
} from './document-parser.js';
import {
  classifyProviderError,
  parseQuotaReset,
  rateLimitRetryAt,
} from './provider-errors.js';

function apiError(
  status: number,
  message: string,
  type?: string,
  headers: Record<string, string> = {},
) {
  return Anthropic.APIError.generate(
    status,
    { type: 'error', error: { type, message } },
    message,
    new Headers(headers),
  );
}

describe('classifyProviderError', () => {
  it('tells an exhausted usage quota from every other token or limit error', () => {
    const credit = classifyProviderError(
      apiError(
        400,
        'Your credit balance is too low to access the Anthropic API.',
        'invalid_request_error',
      ),
    );
    expect(credit).toBeInstanceOf(QuotaExhaustedError);
    expect((credit as QuotaExhaustedError).resetAt).toBeNull();
    expect((credit as QuotaExhaustedError).details).toMatchObject({
      status: 400,
      type: 'invalid_request_error',
    });

    const billing = classifyProviderError(
      apiError(402, 'Payment required', 'billing_error'),
    );
    expect(billing).toBeInstanceOf(QuotaExhaustedError);

    const spend = classifyProviderError(
      apiError(
        400,
        'You have reached your specified API usage limits. You will regain access on 2026-12-01 at 00:00 UTC.',
      ),
    );
    expect((spend as QuotaExhaustedError).resetAt?.toISOString()).toBe(
      '2026-12-01T00:00:00.000Z',
    );

    const rate = classifyProviderError(
      apiError(
        429,
        'Number of request tokens has exceeded your per-minute rate limit',
        'rate_limit_error',
        {
          'retry-after': '30',
        },
      ),
    );
    expect(rate).toBeInstanceOf(RateLimitedError);
    expect((rate as RateLimitedError).retryAt).toBeInstanceOf(Date);

    expect(
      classifyProviderError(
        apiError(400, 'prompt is too long: 1500000 tokens > 1000000 maximum'),
      ),
    ).toBeInstanceOf(ContextTooLargeError);
    expect(
      classifyProviderError(apiError(413, 'Request exceeds the maximum size')),
    ).toBeInstanceOf(ContextTooLargeError);
  });

  it('separates credentials, bad requests and transient failures', () => {
    expect(
      classifyProviderError(apiError(401, 'invalid x-api-key')),
    ).toBeInstanceOf(CredentialsError);
    expect(
      classifyProviderError(apiError(404, 'model: claude-x')),
    ).toBeInstanceOf(CredentialsError);
    expect(
      classifyProviderError(apiError(400, 'messages: roles must alternate')),
    ).toBeInstanceOf(PermanentParseError);
    const overloaded = apiError(529, 'Overloaded', 'overloaded_error');
    expect(classifyProviderError(overloaded)).toBe(overloaded);
    const network = new Error('socket hang up');
    expect(classifyProviderError(network)).toBe(network);
  });
});

describe('parseQuotaReset', () => {
  it('reads the reset time from the provider message, or gives none', () => {
    expect(
      parseQuotaReset(
        'You will regain access on 2026-11-01 at 06:30 UTC',
      )?.toISOString(),
    ).toBe('2026-11-01T06:30:00.000Z');
    expect(parseQuotaReset('Your credit balance is too low')).toBeNull();
  });
});

describe('rateLimitRetryAt', () => {
  const now = new Date('2026-10-29T10:00:00Z');

  it('uses retry-after first', () => {
    expect(
      rateLimitRetryAt(
        new Headers({ 'retry-after': '20' }),
        now,
      )?.toISOString(),
    ).toBe('2026-10-29T10:00:20.000Z');
  });

  it('otherwise uses the reset of the exhausted limit', () => {
    const headers = new Headers({
      'anthropic-ratelimit-requests-remaining': '10',
      'anthropic-ratelimit-requests-reset': '2026-10-29T10:00:05Z',
      'anthropic-ratelimit-tokens-remaining': '0',
      'anthropic-ratelimit-tokens-reset': '2026-10-29T10:00:40Z',
    });
    expect(rateLimitRetryAt(headers, now)?.toISOString()).toBe(
      '2026-10-29T10:00:40.000Z',
    );
    expect(rateLimitRetryAt(new Headers(), now)).toBeNull();
  });
});
