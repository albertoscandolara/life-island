import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { openSecret, sealSecret, secretKeyFromEnv } from './secret-box.js';

describe('secret box', () => {
  const key = randomBytes(32);

  it('seals and opens a secret, bound to its context', () => {
    const sealed = sealSecret('sk-ant-secret', key, 'user-1');
    expect(sealed).not.toContain('sk-ant');
    expect(openSecret(sealed, key, 'user-1')).toBe('sk-ant-secret');
    expect(() => openSecret(sealed, key, 'user-2')).toThrow();
    expect(() => openSecret(sealed, randomBytes(32), 'user-1')).toThrow();
  });

  it('refuses a changed value', () => {
    const sealed = sealSecret('abc', key);
    const parts = sealed.split('.');
    parts[3] = Buffer.from('abd').toString('base64url');
    expect(() => openSecret(parts.join('.'), key)).toThrow();
  });

  it('reads a 32-byte key from the environment', () => {
    expect(secretKeyFromEnv('K', {})).toBeNull();
    expect(
      secretKeyFromEnv('K', { K: key.toString('base64') })?.equals(key),
    ).toBe(true);
    expect(() => secretKeyFromEnv('K', { K: 'c2hvcnQ=' })).toThrow(/32 bytes/);
  });
});
