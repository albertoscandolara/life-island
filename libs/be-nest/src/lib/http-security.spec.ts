import { describe, expect, it } from 'vitest';
import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  crossSiteWriteGuard,
  rateLimit,
  securityHeaders,
} from './http-security.js';

function request(
  method: string,
  headers: Record<string, string> = {},
  url = '/things',
  ip = '10.0.0.1',
) {
  return { method, headers, url, ip } as unknown as IncomingMessage & {
    ip?: string;
  };
}

function response() {
  const headers = new Map<string, string>();
  const res = {
    statusCode: 200,
    body: '',
    setHeader: (name: string, value: string) =>
      headers.set(name.toLowerCase(), value),
    end: (body?: string) => {
      res.body = body ?? '';
    },
  };
  return { res: res as unknown as ServerResponse & { body: string }, headers };
}

function run(
  middleware: ReturnType<typeof securityHeaders>,
  req: IncomingMessage,
) {
  const { res, headers } = response();
  let passed = false;
  middleware(req, res, () => {
    passed = true;
  });
  return { passed, status: res.statusCode, headers };
}

describe('http security', () => {
  it('sets the hardening headers', () => {
    const { passed, headers } = run(securityHeaders(), request('GET'));
    expect(passed).toBe(true);
    expect(headers.get('x-content-type-options')).toBe('nosniff');
    expect(headers.get('cache-control')).toBe('no-store');
    expect(headers.get('x-frame-options')).toBe('SAMEORIGIN');
  });

  it('refuses writes sent by a browser from another site', () => {
    const guard = crossSiteWriteGuard();
    expect(
      run(guard, request('POST', { 'sec-fetch-site': 'cross-site' })).status,
    ).toBe(403);
    expect(
      run(guard, request('DELETE', { 'sec-fetch-site': 'same-site' })).status,
    ).toBe(403);
    expect(
      run(guard, request('POST', { 'sec-fetch-site': 'same-origin' })).passed,
    ).toBe(true);
    // Reads, and calls from another service (no browser header), go on.
    expect(
      run(guard, request('GET', { 'sec-fetch-site': 'cross-site' })).passed,
    ).toBe(true);
    expect(run(guard, request('POST')).passed).toBe(true);
  });

  it('limits each client per minute, health checks aside', () => {
    let time = 0;
    const limit = rateLimit(2, undefined, () => time);
    expect(run(limit, request('GET')).passed).toBe(true);
    expect(run(limit, request('GET')).passed).toBe(true);
    const third = run(limit, request('GET'));
    expect(third.status).toBe(429);
    expect(third.headers.get('retry-after')).toBe('60');
    expect(run(limit, request('GET', {}, '/things', '10.0.0.2')).passed).toBe(
      true,
    );
    expect(run(limit, request('GET', {}, '/health')).passed).toBe(true);
    time = 60_000;
    expect(run(limit, request('GET')).passed).toBe(true);
  });
});
