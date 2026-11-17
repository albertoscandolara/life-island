import { describe, expect, it } from 'vitest';
import { euroText } from './text-format.js';

describe('euroText', () => {
  it('writes euros the Italian way, grouping thousands', () => {
    expect(euroText(3200)).toBe('3.200,00 €');
    expect(euroText(36000, false)).toBe('36.000 €');
    expect(euroText(12.5)).toBe('12,50 €');
    expect(euroText(null)).toBe('–');
  });
});
