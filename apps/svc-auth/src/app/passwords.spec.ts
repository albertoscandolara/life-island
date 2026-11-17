import { describe, expect, it } from 'vitest';
import {
  hashPassword,
  needsRehash,
  passwordProblem,
  verifyPassword,
} from './passwords.js';

describe('passwords', () => {
  it('hashes with a salt and verifies', async () => {
    const one = await hashPassword('correct horse battery');
    const two = await hashPassword('correct horse battery');
    expect(one).not.toBe(two);
    expect(one.startsWith('scrypt$')).toBe(true);
    expect(await verifyPassword('correct horse battery', one)).toBe(true);
    expect(await verifyPassword('correct horse batterY', one)).toBe(false);
    expect(await verifyPassword('x', 'not-a-hash')).toBe(false);
    expect(needsRehash(one)).toBe(false);
    expect(needsRehash('scrypt$1024$8$1$a$b')).toBe(true);
  });

  it('refuses weak passwords', () => {
    expect(passwordProblem('short')).toMatch(/at least 12/);
    expect(passwordProblem('aaaaaaaaaaaaaaa')).toMatch(/repetitive/);
    expect(
      passwordProblem('mario.rossi.2026!', 'mario.rossi@example.com'),
    ).toMatch(/email/);
    expect(passwordProblem('tre gatti sul tetto')).toBeNull();
    expect(passwordProblem(undefined)).toMatch(/Choose/);
  });
});
