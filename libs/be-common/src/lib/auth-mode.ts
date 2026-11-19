import { AsyncLocalStorage } from 'node:async_hooks';
import { isProduction } from './production-guard.js';

/*
 * How a service decides who is calling (docs/security.md, "Sign-in"). Read
 * once at startup; every rule fails closed:
 *
 * - A browser request carries the session cookie that svc-auth set; the
 *   service asks svc-auth who it belongs to (AUTH_URL).
 * - A service calling another sends INTERNAL_TOKEN in X-Internal-Token. The
 *   gateway drops that header from every client request.
 * - AUTH_DEV_BYPASS=true skips sign-in on your own machine, as the local
 *   owner. Only with NODE_ENV=development (or test); anywhere else the
 *   service refuses to start, so it can never be left on by accident.
 */

export const INTERNAL_TOKEN_HEADER = 'x-internal-token';

/** The signed-in person a request acts for. */
export interface RequestUser {
  id: string;
  role: 'owner' | 'member';
  /** A service calling another, not a person. */
  internal?: boolean;
}

/** The person "signed in" when AUTH_DEV_BYPASS skips the login. */
export const DEV_OWNER: RequestUser = {
  id: '00000000-0000-4000-8000-000000000001',
  role: 'owner',
};

export interface AuthSettings {
  devBypass: boolean;
  /** Shared secret of service-to-service calls; null only with the dev bypass. */
  internalToken: string | null;
  /** Where svc-auth answers, e.g. http://svc-auth:3000. */
  authUrl: string;
}

export const LOCAL_AUTH_URL = 'http://localhost:3020';

const DEV_ENVIRONMENTS = new Set(['development', 'test']);

export function authSettingsFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): AuthSettings {
  const bypassRaw = env['AUTH_DEV_BYPASS']?.trim().toLowerCase() ?? '';
  const devBypass = ['1', 'true', 'yes', 'on'].includes(bypassRaw);
  const nodeEnv = env['NODE_ENV']?.trim().toLowerCase() ?? '';
  if (devBypass && (isProduction(env) || !DEV_ENVIRONMENTS.has(nodeEnv)))
    throw new Error(
      'AUTH_DEV_BYPASS=true skips sign-in and only works with NODE_ENV=development. ' +
        `NODE_ENV is "${nodeEnv || 'unset'}": remove AUTH_DEV_BYPASS, or set NODE_ENV=development on your own machine.`,
    );
  const internalToken = env['INTERNAL_TOKEN']?.trim() || null;
  if (internalToken && internalToken.length < 32)
    throw new Error(
      'INTERNAL_TOKEN must be at least 32 characters (make one with: openssl rand -base64 32)',
    );
  if (!internalToken && !devBypass)
    throw new Error(
      'INTERNAL_TOKEN is missing. Every service needs the same random value (openssl rand -base64 32), ' +
        'or AUTH_DEV_BYPASS=true with NODE_ENV=development on your own machine.',
    );
  return {
    devBypass,
    internalToken,
    authUrl: (env['AUTH_URL']?.trim() || LOCAL_AUTH_URL).replace(/\/+$/, ''),
  };
}

/**
 * What services send as their internal token on your own machine when
 * AUTH_DEV_BYPASS is on and no INTERNAL_TOKEN is set. Without it a call from
 * one service to another would arrive as the dev owner, not as a service,
 * and the endpoints only services may call (such as the AI spending guard)
 * would refuse it. Accepted only by a service that runs the dev bypass with
 * no INTERNAL_TOKEN of its own.
 */
export const DEV_INTERNAL_TOKEN = 'life-island-dev-bypass';

/**
 * Headers for a call to another service: the internal token when one is set,
 * else the dev one under the dev bypass. Spread them into every
 * service-to-service fetch.
 */
export function internalHeaders(
  env: NodeJS.ProcessEnv = process.env,
): Record<string, string> {
  const token = env['INTERNAL_TOKEN']?.trim();
  if (token) return { 'X-Internal-Token': token };
  const bypass = ['1', 'true', 'yes', 'on'].includes(
    env['AUTH_DEV_BYPASS']?.trim().toLowerCase() ?? '',
  );
  const nodeEnv = env['NODE_ENV']?.trim().toLowerCase() ?? '';
  return bypass && DEV_ENVIRONMENTS.has(nodeEnv) && !isProduction(env)
    ? { 'X-Internal-Token': DEV_INTERNAL_TOKEN }
    : {};
}

const requestUser = new AsyncLocalStorage<RequestUser>();

/** Runs `work` on behalf of `user`; `currentUser()` answers it inside. */
export function runAsUser<T>(user: RequestUser, work: () => T): T {
  return requestUser.run(user, work);
}

/** The person the running request acts for, or null outside a request (a consumer, a schedule). */
export function currentUser(): RequestUser | null {
  return requestUser.getStore() ?? null;
}
