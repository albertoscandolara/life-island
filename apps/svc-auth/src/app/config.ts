import {
  booleanEnv,
  isProduction,
  numberEnv,
  secretKeyFromEnv,
} from '@life-island/be-common';

export interface AuthConfig {
  port: number;
  databaseUrl: string;
  /**
   * Cookies only over HTTPS (`__Host-li_session`). Browsers treat
   * http://localhost as secure too, so this stays on unless an old browser
   * needs it off on your own machine; production refuses to turn it off.
   */
  cookieSecure: boolean;
  /** Signed out after this long without a request. */
  sessionIdleHours: number;
  /** Signed out after this long whatever happens. */
  sessionMaxDays: number;
  /**
   * The one-time secret that lets the first person create the owner account
   * (POST /setup). Unset, nobody can, and the island has no account yet.
   */
  setupToken: string | null;
  /** Encrypts the two-factor seeds at rest (AUTH_ENCRYPTION_KEY, 32 bytes base64). */
  encryptionKey: Buffer | null;
  /** Every account needs a two-factor app before it can see anything. */
  requireTwoFactor: boolean;
  /** Sign-in attempts per minute from one address. */
  loginPerMinute: number;
  /** Wrong passwords or codes in a row before an account waits. */
  lockAfterFailures: number;
  lockMinutes: number;
  inviteDays: number;
}

export const LOCAL_AUTH_PORT = 3020;
export const LOCAL_AUTH_DATABASE_URL =
  'postgres://auth_svc:dev_auth@localhost:5432/life_island';

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AuthConfig {
  const production = isProduction(env);
  const cookieSecure = booleanEnv('AUTH_COOKIE_SECURE', true, env);
  if (production && !cookieSecure)
    throw new Error('AUTH_COOKIE_SECURE=false is not allowed in production.');
  const encryptionKey = secretKeyFromEnv('AUTH_ENCRYPTION_KEY', env);
  if (production && !encryptionKey)
    throw new Error(
      'AUTH_ENCRYPTION_KEY is missing: set 32 random bytes in base64 (openssl rand -base64 32).',
    );
  const setupToken = env['AUTH_SETUP_TOKEN']?.trim() || null;
  if (setupToken && setupToken.length < 24)
    throw new Error('AUTH_SETUP_TOKEN must be at least 24 characters.');
  return {
    port: numberEnv('AUTH_PORT', numberEnv('PORT', LOCAL_AUTH_PORT, env), env),
    databaseUrl: env['AUTH_DATABASE_URL'] || LOCAL_AUTH_DATABASE_URL,
    cookieSecure,
    sessionIdleHours: numberEnv('AUTH_SESSION_IDLE_HOURS', 12, env),
    sessionMaxDays: numberEnv('AUTH_SESSION_MAX_DAYS', 30, env),
    setupToken,
    encryptionKey,
    requireTwoFactor: booleanEnv('AUTH_REQUIRE_TWO_FACTOR', production, env),
    loginPerMinute: numberEnv('AUTH_LOGIN_PER_MINUTE', 10, env),
    lockAfterFailures: numberEnv('AUTH_LOCK_AFTER_FAILURES', 5, env),
    lockMinutes: numberEnv('AUTH_LOCK_MINUTES', 15, env),
    inviteDays: numberEnv('AUTH_INVITE_DAYS', 7, env),
  };
}

export const CONFIG = Symbol('AuthConfig');
export const SERVICE_DB = Symbol('ServiceDb');
