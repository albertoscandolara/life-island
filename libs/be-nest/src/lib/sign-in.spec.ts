import {
  currentUser,
  DEV_OWNER,
  type AuthSettings,
} from '@life-island/be-common';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { describe, expect, it, vi } from 'vitest';
import { requireSignIn, sessionCookie } from './sign-in.js';

const TOKEN = 't'.repeat(32);
const SESSION = 's'.repeat(43);
const settings: AuthSettings = {
  devBypass: false,
  internalToken: TOKEN,
  authUrl: 'http://auth',
};

function request(headers: Record<string, string> = {}, url = '/things') {
  return { headers, url } as unknown as IncomingMessage;
}

async function run(
  middleware: ReturnType<typeof requireSignIn>,
  req: IncomingMessage,
) {
  const res = {
    statusCode: 200,
    body: '',
    setHeader: () => undefined,
    end(body?: string) {
      this.body = body ?? '';
    },
  };
  let user: unknown = 'not called';
  await middleware(req, res as unknown as ServerResponse, () => {
    user = currentUser();
  });
  return { status: res.statusCode, user, body: res.body };
}

function auth(answer: { status: number; body?: unknown }) {
  return vi.fn(
    async () =>
      new Response(JSON.stringify(answer.body ?? {}), {
        status: answer.status,
      }),
  ) as unknown as typeof fetch;
}

describe('requireSignIn', () => {
  it('refuses a request with no session', async () => {
    const result = await run(
      requireSignIn(settings, { fetchImpl: auth({ status: 401 }) }),
      request(),
    );
    expect(result.status).toBe(401);
    expect(result.user).toBe('not called');
  });

  it('lets health checks through', async () => {
    const result = await run(requireSignIn(settings), request({}, '/health'));
    expect(result.user).toBeNull();
  });

  it('lets through only the GET paths a route guards with its own secret', async () => {
    const middleware = requireSignIn(settings, {
      fetchImpl: auth({ status: 401 }),
      openPaths: [/^\/calendar\/feed\/[A-Za-z0-9_-]{43}\.ics$/],
    });
    const feed = `/calendar/feed/${'a'.repeat(43)}.ics`;
    const get = (url: string, method = 'GET') =>
      ({ headers: {}, url, method }) as unknown as IncomingMessage;
    expect((await run(middleware, get(`${feed}?x=1`))).user).toBeNull();
    // Not a write, not a longer path, not another route.
    expect((await run(middleware, get(feed, 'DELETE'))).status).toBe(401);
    expect((await run(middleware, get(`${feed}/x`))).status).toBe(401);
    expect((await run(middleware, get('/calendar'))).status).toBe(401);
  });

  it('accepts another service with the internal token, and only that token', async () => {
    const middleware = requireSignIn(settings);
    expect(
      (await run(middleware, request({ 'x-internal-token': TOKEN }))).user,
    ).toMatchObject({ internal: true });
    expect(
      (await run(middleware, request({ 'x-internal-token': 'wrong' }))).status,
    ).toBe(401);
  });

  it('asks svc-auth about a session cookie and remembers the answer', async () => {
    const fetchImpl = auth({
      status: 200,
      body: { user: { id: 'u1', role: 'member' }, ready: true },
    });
    let time = 0;
    const middleware = requireSignIn(settings, { fetchImpl, now: () => time });
    const req = request({ cookie: `theme=dark; __Host-li_session=${SESSION}` });
    expect((await run(middleware, req)).user).toEqual({
      id: 'u1',
      role: 'member',
    });
    await run(middleware, req);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    time = 31_000;
    await run(middleware, req);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('refuses an ended session, and one still setting up two-factor', async () => {
    const req = request({ cookie: `li_session=${SESSION}` });
    expect(
      (
        await run(
          requireSignIn(settings, { fetchImpl: auth({ status: 401 }) }),
          req,
        )
      ).status,
    ).toBe(401);
    const notReady = auth({
      status: 200,
      body: { user: { id: 'u1', role: 'owner' }, ready: false },
    });
    expect(
      (await run(requireSignIn(settings, { fetchImpl: notReady }), req)).status,
    ).toBe(403);
  });

  it('fails closed when svc-auth cannot be reached', async () => {
    const down = vi.fn(async () => {
      throw new Error('ECONNREFUSED');
    }) as unknown as typeof fetch;
    const req = request({ cookie: `li_session=${SESSION}` });
    expect(
      (await run(requireSignIn(settings, { fetchImpl: down }), req)).status,
    ).toBe(503);
  });

  it('signs in as the local owner with the dev bypass', async () => {
    const result = await run(
      requireSignIn({ ...settings, devBypass: true, internalToken: null }),
      request(),
    );
    expect(result.user).toEqual(DEV_OWNER);
  });

  it('reads only well-formed session cookies', () => {
    expect(sessionCookie(`li_session=${SESSION}`)).toEqual({
      name: 'li_session',
      value: SESSION,
    });
    expect(sessionCookie('li_session=short')).toBeNull();
    expect(sessionCookie('other=abc')).toBeNull();
  });
});
