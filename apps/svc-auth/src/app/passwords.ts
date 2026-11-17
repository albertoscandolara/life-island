import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';

/*
 * Password hashes with scrypt (memory-hard, in Node's own crypto, no native
 * module to build). Stored as `scrypt$<N>$<r>$<p>$<salt>$<hash>` so the cost
 * can be raised later: a hash made with older parameters still verifies, and
 * `needsRehash` says when to store a new one at the next sign-in.
 */

const N = 2 ** 15;
const R = 8;
const P = 1;
const KEY_LENGTH = 64;
const MAX_MEMORY = 128 * N * R * 2;

export const MIN_PASSWORD_LENGTH = 12;
export const MAX_PASSWORD_LENGTH = 256;

function derive(
  password: string,
  salt: Buffer,
  n: number,
  r: number,
  p: number,
): Promise<Buffer> {
  return new Promise((resolve, reject) =>
    scrypt(
      password.normalize('NFKC'),
      salt,
      KEY_LENGTH,
      { N: n, r, p, maxmem: Math.max(MAX_MEMORY, 128 * n * r * 2) },
      (error, key) => (error ? reject(error) : resolve(key)),
    ),
  );
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await derive(password, salt, N, R, P);
  return [
    'scrypt',
    N,
    R,
    P,
    salt.toString('base64url'),
    key.toString('base64url'),
  ].join('$');
}

export async function verifyPassword(
  password: string,
  stored: string,
): Promise<boolean> {
  const [scheme, n, r, p, salt, hash] = stored.split('$');
  if (scheme !== 'scrypt' || !n || !r || !p || !salt || !hash) return false;
  const expected = Buffer.from(hash, 'base64url');
  const key = await derive(
    password,
    Buffer.from(salt, 'base64url'),
    Number(n),
    Number(r),
    Number(p),
  );
  return key.length === expected.length && timingSafeEqual(key, expected);
}

export function needsRehash(stored: string): boolean {
  const [, n, r, p] = stored.split('$');
  return Number(n) !== N || Number(r) !== R || Number(p) !== P;
}

/** A hash no password matches, checked for unknown emails so both cases take the same time. */
export const DECOY_HASH = await hashPassword(
  randomBytes(24).toString('base64url'),
);

/** Why a new password is refused, or null when it is fine. */
export function passwordProblem(
  password: unknown,
  email?: string,
): string | null {
  if (typeof password !== 'string') return 'Choose a password.';
  if (password.length < MIN_PASSWORD_LENGTH)
    return `Use at least ${MIN_PASSWORD_LENGTH} characters; a few words in a row are easy to remember.`;
  if (password.length > MAX_PASSWORD_LENGTH)
    return `Use at most ${MAX_PASSWORD_LENGTH} characters.`;
  if (
    email &&
    password
      .toLowerCase()
      .includes(email.toLowerCase().split('@')[0] ?? '\u0000')
  )
    return 'Do not use your email in the password.';
  if (new Set(password).size < 5) return 'Use a less repetitive password.';
  return null;
}
