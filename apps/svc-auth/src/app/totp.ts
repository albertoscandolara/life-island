import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/*
 * Two-factor codes (TOTP, RFC 6238): 6 digits, 30-second steps, SHA-1, the
 * format every authenticator app reads. A code is accepted one step early or
 * late for clock drift, and each step only once (the caller stores the last
 * step used), so a code seen over a shoulder cannot be replayed.
 */

const STEP_SECONDS = 30;
const DIGITS = 6;
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function newTotpSecret(): string {
  return base32Encode(randomBytes(20));
}

/** The link an authenticator app opens (or a QR code carries). */
export function otpauthUrl(
  secret: string,
  account: string,
  issuer = 'Life Island',
): string {
  const label = encodeURIComponent(`${issuer}:${account}`);
  const params = new URLSearchParams({
    secret,
    issuer,
    algorithm: 'SHA1',
    digits: String(DIGITS),
    period: String(STEP_SECONDS),
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}

export function totpCode(secret: string, step: number): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const digest = createHmac('sha1', base32Decode(secret))
    .update(counter)
    .digest();
  const offset = (digest[digest.length - 1] ?? 0) & 0x0f;
  const value = (digest.readUInt32BE(offset) & 0x7fffffff) % 10 ** DIGITS;
  return value.toString().padStart(DIGITS, '0');
}

export function currentStep(now = Date.now()): number {
  return Math.floor(now / 1000 / STEP_SECONDS);
}

/** The step a code belongs to (now ±1), if it is right and newer than `lastStep`; else null. */
export function verifyTotp(
  secret: string,
  code: unknown,
  lastStep: number | null,
  now = Date.now(),
): number | null {
  if (typeof code !== 'string') return null;
  const clean = code.replace(/\s/g, '');
  if (!/^\d{6}$/.test(clean)) return null;
  const step = currentStep(now);
  for (const candidate of [step - 1, step, step + 1]) {
    if (lastStep !== null && candidate <= lastStep) continue;
    const expected = Buffer.from(totpCode(secret, candidate));
    if (timingSafeEqual(expected, Buffer.from(clean))) return candidate;
  }
  return null;
}

export function base32Encode(bytes: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(text: string): Buffer {
  const clean = text.toUpperCase().replace(/[^A-Z2-7]/g, '');
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const char of clean) {
    value = (value << 5) | ALPHABET.indexOf(char);
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}
