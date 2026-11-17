import { describe, expect, it } from 'vitest';
import {
  base32Decode,
  base32Encode,
  currentStep,
  otpauthUrl,
  totpCode,
  verifyTotp,
} from './totp.js';

// RFC 6238 appendix B: the SHA-1 seed "12345678901234567890".
const RFC_SECRET = base32Encode(Buffer.from('12345678901234567890'));

describe('TOTP', () => {
  it('matches the RFC 6238 test vectors (last 6 digits)', () => {
    expect(totpCode(RFC_SECRET, currentStep(59_000))).toBe('287082');
    expect(totpCode(RFC_SECRET, currentStep(1_111_111_109_000))).toBe('081804');
    expect(totpCode(RFC_SECRET, currentStep(2_000_000_000_000))).toBe('279037');
  });

  it('round-trips base32', () => {
    const bytes = Buffer.from('any bytes at all');
    expect(base32Decode(base32Encode(bytes)).equals(bytes)).toBe(true);
  });

  it('accepts a code one step either side, once', () => {
    const now = 1_700_000_000_000;
    const step = currentStep(now);
    const code = totpCode(RFC_SECRET, step - 1);
    expect(verifyTotp(RFC_SECRET, code, null, now)).toBe(step - 1);
    expect(verifyTotp(RFC_SECRET, code, step - 1, now)).toBeNull();
    expect(
      verifyTotp(RFC_SECRET, totpCode(RFC_SECRET, step - 2), null, now),
    ).toBeNull();
    expect(verifyTotp(RFC_SECRET, '12345', null, now)).toBeNull();
    expect(verifyTotp(RFC_SECRET, 123456, null, now)).toBeNull();
  });

  it('builds the authenticator link', () => {
    expect(otpauthUrl('ABC', 'me@example.com')).toBe(
      'otpauth://totp/Life%20Island%3Ame%40example.com?secret=ABC&issuer=Life+Island&algorithm=SHA1&digits=6&period=30',
    );
  });
});
