import { describe, expect, it, vi } from 'vitest';
import {
  AiSpendDenied,
  HttpAiSpendGuard,
  tokensOf,
  worstCaseUsd,
} from './ai-spend-guard.js';

const request = {
  toolId: 'money.review',
  service: 'svc-money',
  userId: 'u1',
  maxUsd: 0.2,
};

describe('AI spending guard client', () => {
  it('returns the reservation, or the reason it was refused', async () => {
    const ok = vi.fn(
      async () =>
        new Response(JSON.stringify({ reservationId: 'r1' }), { status: 200 }),
    );
    expect(
      await new HttpAiSpendGuard(
        'http://s',
        ok as unknown as typeof fetch,
      ).reserve(request),
    ).toBe('r1');
    const refused = vi.fn(
      async () =>
        new Response(JSON.stringify({ message: 'Daily allowance reached.' }), {
          status: 429,
        }),
    );
    await expect(
      new HttpAiSpendGuard(
        'http://s',
        refused as unknown as typeof fetch,
      ).reserve(request),
    ).rejects.toThrow(new AiSpendDenied('Daily allowance reached.'));
  });

  it('fails closed when svc-settings is down', async () => {
    const down = vi.fn(async () => {
      throw new Error('ECONNREFUSED');
    });
    await expect(
      new HttpAiSpendGuard('http://s', down as unknown as typeof fetch).reserve(
        request,
      ),
    ).rejects.toThrow(/cannot be reached/);
  });

  it('prices the worst case of a request', () => {
    expect(tokensOf('abcdef')).toBe(2);
    // Sonnet 5.5: $2 in, $10 out per million.
    expect(
      worstCaseUsd('claude-sonnet-5-5', {
        inputTokens: 1_000_000,
        maxTokens: 100_000,
      }),
    ).toBeCloseTo(3);
    expect(
      worstCaseUsd('claude-sonnet-5-5', {
        inputTokens: 0,
        maxTokens: 0,
        webSearches: 2,
      }),
    ).toBeCloseTo(0.02 + 0.032);
  });
});
