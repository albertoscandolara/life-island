import { requestCostUsd, type AiReserveRequest } from '@life-island/contracts';
import { internalHeaders } from './auth-mode.js';

/*
 * The service side of the AI spending guard (docs/security.md, "AI cost
 * guards"): reserve a call's worst-case cost with svc-settings before calling
 * the model, settle the real cost after. Fails closed: when svc-settings
 * cannot be reached, no model is called.
 */

export const LOCAL_SETTINGS_URL = 'http://localhost:3009';

/** A call the guard refused, with the reason in words for the person. */
export class AiSpendDenied extends Error {}

export interface AiSpendGuard {
  reserve(request: AiReserveRequest): Promise<string>;
  settle(reservationId: string, actualUsd: number): Promise<void>;
}

export class HttpAiSpendGuard implements AiSpendGuard {
  constructor(
    private readonly settingsUrl: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  static fromEnv(env: NodeJS.ProcessEnv = process.env): HttpAiSpendGuard {
    return new HttpAiSpendGuard(
      (env['SETTINGS_URL']?.trim() || LOCAL_SETTINGS_URL).replace(/\/+$/, ''),
    );
  }

  async reserve(request: AiReserveRequest): Promise<string> {
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.settingsUrl}/ai-guard/reserve`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...internalHeaders() },
        body: JSON.stringify(request),
        signal: AbortSignal.timeout(5000),
      });
    } catch {
      throw new AiSpendDenied(
        'AI is paused: the spending guard (svc-settings) cannot be reached. Try again in a moment.',
      );
    }
    const body = (await response.json().catch(() => ({}))) as {
      reservationId?: string;
      message?: unknown;
    };
    if (response.ok && body.reservationId) return body.reservationId;
    throw new AiSpendDenied(
      typeof body.message === 'string'
        ? body.message
        : `AI is paused: the spending guard answered ${response.status}.`,
    );
  }

  async settle(reservationId: string, actualUsd: number): Promise<void> {
    await this.fetchImpl(
      `${this.settingsUrl}/ai-guard/reservations/${encodeURIComponent(reservationId)}/settle`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...internalHeaders() },
        body: JSON.stringify({ actualUsd: Math.round(actualUsd * 1e6) / 1e6 }),
        signal: AbortSignal.timeout(5000),
      },
    );
  }
}

/** About how many tokens a text is: 3 characters a token, rounded up, on the safe side. */
export function tokensOf(text: string): number {
  return Math.ceil(text.length / 3);
}

/**
 * The most one request can cost: its input as estimated, every output token
 * it may write, and every web search it may run (each search also brings
 * results back as input, counted at 8,000 tokens).
 */
export function worstCaseUsd(
  model: string,
  request: { inputTokens: number; maxTokens: number; webSearches?: number },
): number {
  const searches = request.webSearches ?? 0;
  return requestCostUsd(model, {
    inputTokens: request.inputTokens + searches * 8000,
    outputTokens: request.maxTokens,
    webSearches: searches,
  });
}
