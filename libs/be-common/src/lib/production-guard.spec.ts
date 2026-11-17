import { describe, expect, it } from 'vitest';
import {
  findDevSecrets,
  isDevSecret,
  isProduction,
  refuseDevSecretsInProduction,
} from './production-guard.js';

describe('production guard', () => {
  it('recognises the local stack secrets', () => {
    expect(
      isDevSecret('postgres://money_svc:dev_money@localhost:5432/life_island'),
    ).toBe(true);
    expect(isDevSecret('postgres://postgres:postgres@db/life_island')).toBe(
      true,
    );
    expect(isDevSecret('dev_access_key')).toBe(true);
    expect(isDevSecret('dev_secret_key')).toBe(true);
    expect(
      isDevSecret('postgres://money_svc:Xk29!p@db.internal:5432/life_island'),
    ).toBe(false);
    expect(isDevSecret('developer')).toBe(false);
  });

  it('names where each dev secret sits', () => {
    expect(
      findDevSecrets({
        databaseUrl: 'postgres://a_svc:dev_a@localhost/x',
        storage: { accessKeyId: 'real', secretAccessKey: 'dev_secret_key' },
        list: ['ok', 'dev_access_key'],
        port: 3000,
      }),
    ).toEqual(['databaseUrl', 'storage.secretAccessKey', 'list[1]']);
  });

  it('only stops a service in production', () => {
    const config = { databaseUrl: 'postgres://a_svc:dev_a@localhost/x' };
    expect(() =>
      refuseDevSecretsInProduction('svc-a', config, {
        NODE_ENV: 'development',
      }),
    ).not.toThrow();
    expect(() =>
      refuseDevSecretsInProduction('svc-a', config, { NODE_ENV: 'production' }),
    ).toThrow(/svc-a refuses to start in production .* databaseUrl/);
    expect(isProduction({ NODE_ENV: ' Production ' })).toBe(true);
  });
});
