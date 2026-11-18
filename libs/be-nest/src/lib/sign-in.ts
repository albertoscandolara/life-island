import { Logger } from '@nestjs/common';
import {
  DEV_OWNER,
  INTERNAL_TOKEN_HEADER,
  runAsUser,
  type AuthSettings,
  type RequestUser,
} from '@life-island/be-common';
import { createHash, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';

/*
 * Every service's door (docs/security.md, "Sign-in"). A request goes on only
 * when it is:
 * - from a service: the right X-Internal-Token;
 * - from a signed-in browser: a session cookie svc-auth vouches for (asked
 *   over GET /session, remembered for a few seconds);
 * - on your own machine with AUTH_DEV_BYPASS, as the local owner.
 * Everything else gets 401. The handler then reads the person with
 * `currentUser()` (libs/be-common).
 */

/** The session cookie svc-auth sets: `__Host-` over HTTPS, plain on http://localhost. */
export const SESSION_COOKIES = ['__Host-li_session', 'li_session'] as const;

/** Paths that answer without sign-in: health checks only. */
const OPEN_PATHS = new Set(['/health', '/healthz']);

/** How long a verified session is trusted before svc-auth is asked again. */
const VERIFIED_TTL_MS = 30_000;
const CACHE_LIMIT = 1000;

type Next = (error?: unknown) => void;
type Middleware = (
  req: IncomingMessage,
  res: ServerResponse,
  next: Next,
) => void | Promise<void>;

/** What svc-auth's GET /session answers for a valid session. */
interface SessionAnswer {
  user: { id: string; role: 'owner' | 'member' };
  /** False while a required second factor is not set up yet. */
  ready: boolean;
}

export interface SignInOptions {
  /**
   * Paths that answer without sign-in because the route checks a secret of
   * its own (the Agenda's private calendar link). Each must match the whole
   * path; keep them as narrow as the route.
   */
  openPaths?: readonly RegExp[];
  fetchImpl?: typeof fetch;
  now?: () => number;
  logger?: Logger;
}

export function requireSignIn(
  settings: AuthSettings,
  options: SignInOptions = {},
): Middleware {
  const fetchImpl = options.fetchImpl ?? fetch;
  const now = options.now ?? Date.now;
  const logger = options.logger ?? new Logger('SignIn');
  const verified = new Map<string, { answer: SessionAnswer; until: number }>();
  const token = settings.internalToken
    ? Buffer.from(settings.internalToken)
    : null;

  const openPaths = options.openPaths ?? [];
  return async (req, res, next) => {
    const path = (req.url ?? '/').split('?')[0] ?? '/';
    if (OPEN_PATHS.has(path)) return next();
    if (req.method === 'GET' && openPaths.some((open) => open.test(path)))
      return next();

    const offered = headerValue(req, INTERNAL_TOKEN_HEADER);
    if (offered !== undefined) {
      if (token && safeEqual(Buffer.from(offered), token))
        return runAsUser(
          { id: 'internal', role: 'owner', internal: true },
          next,
        );
      return deny(res, 401, 'Sign in to continue.');
    }

    if (settings.devBypass) return runAsUser(DEV_OWNER, next);

    const session = sessionCookie(req.headers.cookie);
    if (!session) return deny(res, 401, 'Sign in to continue.');

    const key = createHash('sha256').update(session.value).digest('hex');
    const time = now();
    let answer = verified.get(key);
    if (!answer || answer.until <= time) {
      verified.delete(key);
      const fresh = await askAuth(settings, session, fetchImpl).catch(
        (error: unknown) => {
          logger.error(`Could not reach svc-auth: ${String(error)}`);
          return 'unreachable' as const;
        },
      );
      if (fresh === 'unreachable')
        return deny(
          res,
          503,
          'Sign-in is not available right now. Try again in a moment.',
        );
      if (!fresh)
        return deny(res, 401, 'Your session has ended. Sign in again.');
      if (verified.size >= CACHE_LIMIT) verified.clear();
      answer = { answer: fresh, until: time + VERIFIED_TTL_MS };
      verified.set(key, answer);
    }
    if (!answer.answer.ready)
      return deny(res, 403, 'Finish setting up two-factor sign-in first.');
    const user: RequestUser = {
      id: answer.answer.user.id,
      role: answer.answer.user.role,
    };
    return runAsUser(user, next);
  };
}

async function askAuth(
  settings: AuthSettings,
  session: { name: string; value: string },
  fetchImpl: typeof fetch,
): Promise<SessionAnswer | null> {
  const response = await fetchImpl(`${settings.authUrl}/session`, {
    headers: {
      cookie: `${session.name}=${session.value}`,
      ...(settings.internalToken
        ? { 'X-Internal-Token': settings.internalToken }
        : {}),
    },
    signal: AbortSignal.timeout(5000),
  });
  if (response.status === 401) return null;
  if (!response.ok) throw new Error(`svc-auth answered ${response.status}`);
  const body = (await response.json()) as Partial<SessionAnswer>;
  if (
    !body.user?.id ||
    (body.user.role !== 'owner' && body.user.role !== 'member')
  )
    return null;
  return { user: body.user, ready: body.ready !== false };
}

/** The first session cookie in a Cookie header. */
export function sessionCookie(
  header: string | undefined,
): { name: string; value: string } | null {
  if (!header) return null;
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index < 0) continue;
    const name = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (
      (SESSION_COOKIES as readonly string[]).includes(name) &&
      /^[A-Za-z0-9_-]{20,200}$/.test(value)
    )
      return { name, value };
  }
  return null;
}

function headerValue(req: IncomingMessage, name: string): string | undefined {
  const value = req.headers[name];
  return Array.isArray(value) ? value[0] : value;
}

function safeEqual(a: Buffer, b: Buffer): boolean {
  return a.length === b.length && timingSafeEqual(a, b);
}

function deny(res: ServerResponse, status: number, message: string): void {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify({ statusCode: status, message }));
}
