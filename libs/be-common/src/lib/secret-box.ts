import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

/*
 * Encryption at rest for the few secrets a service keeps in its database (a
 * TOTP seed, a Claude API key): AES-256-GCM with a 32-byte key from the
 * environment, never from the database. A sealed value carries its version,
 * nonce and tag, so it can be checked and the key rotated later.
 *
 *   v1.<nonce>.<tag>.<ciphertext>   (base64url parts)
 */

const VERSION = 'v1';

/** Reads a 32-byte key given as base64 (or base64url): `openssl rand -base64 32`. */
export function secretKeyFromEnv(
  name: string,
  env: NodeJS.ProcessEnv = process.env,
): Buffer | null {
  const raw = env[name]?.trim();
  if (!raw) return null;
  const key = Buffer.from(
    raw,
    raw.includes('-') || raw.includes('_') ? 'base64url' : 'base64',
  );
  if (key.length !== 32)
    throw new Error(
      `${name} must be 32 bytes in base64 (make one with: openssl rand -base64 32), got ${key.length} bytes`,
    );
  return key;
}

/** Encrypts a secret; `context` (e.g. a user id) binds it to where it is stored. */
export function sealSecret(plain: string, key: Buffer, context = ''): string {
  const nonce = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, nonce);
  cipher.setAAD(Buffer.from(context, 'utf8'));
  const body = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return [
    VERSION,
    nonce.toString('base64url'),
    cipher.getAuthTag().toString('base64url'),
    body.toString('base64url'),
  ].join('.');
}

/** Decrypts a sealed secret; throws if it was changed, or sealed with another key or context. */
export function openSecret(sealed: string, key: Buffer, context = ''): string {
  const [version, nonce, tag, body] = sealed.split('.');
  if (version !== VERSION || !nonce || !tag || body === undefined)
    throw new Error('Not a sealed secret');
  const decipher = createDecipheriv(
    'aes-256-gcm',
    key,
    Buffer.from(nonce, 'base64url'),
  );
  decipher.setAAD(Buffer.from(context, 'utf8'));
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([
    decipher.update(Buffer.from(body, 'base64url')),
    decipher.final(),
  ]).toString('utf8');
}
