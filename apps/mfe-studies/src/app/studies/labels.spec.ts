import { describe, expect, it } from 'vitest';
import {
  daysText,
  duration,
  errorText,
  hostOf,
  numberOrNull,
  safeUrl,
} from './labels';

describe('labels', () => {
  it('writes durations and day counts as people say them', () => {
    expect(duration(45)).toBe('45 min');
    expect(duration(60)).toBe('1 h');
    expect(duration(150)).toBe('2 h 30 min');
    expect(daysText(0)).toBe('today');
    expect(daysText(1)).toBe('tomorrow');
    expect(daysText(5)).toBe('in 5 days');
    expect(daysText(-3)).toBe('3 days ago');
  });

  it('opens only web links', () => {
    expect(safeUrl('https://www.udemy.com/')).toBe('https://www.udemy.com/');
    expect(safeUrl('javascript:alert(1)')).toBeNull();
    expect(safeUrl(null)).toBeNull();
    expect(hostOf('https://www.udemy.com/course/x')).toBe('udemy.com');
  });

  it('reads numbers typed with a comma', () => {
    expect(numberOrNull('39,90')).toBe(39.9);
    expect(numberOrNull('')).toBeNull();
    expect(numberOrNull('abc')).toBeNull();
  });

  it('explains what the API refused, issue by issue', () => {
    expect(
      errorText(
        {
          status: 400,
          error: {
            message: 'Invalid request',
            issues: [{ message: 'Use a web address starting with https://' }],
          },
        },
        'x',
      ),
    ).toBe('Use a web address starting with https://');
    expect(errorText({ status: 0 }, 'x')).toContain('not reachable');
    expect(errorText(null, 'Fallback')).toBe('Fallback');
  });
});
