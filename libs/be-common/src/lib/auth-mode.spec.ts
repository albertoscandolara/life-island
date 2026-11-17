import { describe, expect, it } from 'vitest';
import {
  authSettingsFromEnv,
  currentUser,
  DEV_OWNER,
  internalHeaders,
  runAsUser,
} from './auth-mode.js';

const TOKEN = 'x'.repeat(32);

describe('auth settings', () => {
  it('allows the dev bypass only in development or tests', () => {
    expect(
      authSettingsFromEnv({ AUTH_DEV_BYPASS: 'true', NODE_ENV: 'development' })
        .devBypass,
    ).toBe(true);
    expect(
      authSettingsFromEnv({ AUTH_DEV_BYPASS: 'true', NODE_ENV: 'test' })
        .devBypass,
    ).toBe(true);
    expect(() =>
      authSettingsFromEnv({ AUTH_DEV_BYPASS: 'true', NODE_ENV: 'production' }),
    ).toThrow(/only works with NODE_ENV=development/);
    expect(() => authSettingsFromEnv({ AUTH_DEV_BYPASS: 'true' })).toThrow(
      /unset/,
    );
  });

  it('needs an internal token without the bypass', () => {
    expect(() => authSettingsFromEnv({ NODE_ENV: 'production' })).toThrow(
      /INTERNAL_TOKEN is missing/,
    );
    expect(() =>
      authSettingsFromEnv({ NODE_ENV: 'production', INTERNAL_TOKEN: 'short' }),
    ).toThrow(/at least 32/);
    const settings = authSettingsFromEnv({
      NODE_ENV: 'production',
      INTERNAL_TOKEN: TOKEN,
      AUTH_URL: 'http://svc-auth:3000/',
    });
    expect(settings).toEqual({
      devBypass: false,
      internalToken: TOKEN,
      authUrl: 'http://svc-auth:3000',
    });
  });

  it('adds the internal token to service calls', () => {
    expect(internalHeaders({ INTERNAL_TOKEN: TOKEN })).toEqual({
      'X-Internal-Token': TOKEN,
    });
    expect(internalHeaders({})).toEqual({});
  });

  it('knows the user of the running request', () => {
    expect(currentUser()).toBeNull();
    expect(runAsUser(DEV_OWNER, () => currentUser())).toEqual(DEV_OWNER);
  });
});
