import {
  daysText,
  duration,
  errorText,
  numberOrNull,
  percent,
  textOrNull,
} from './format';

describe('format', () => {
  it('says how far a date is', () => {
    expect(daysText(0)).toBe('today');
    expect(daysText(1)).toBe('tomorrow');
    expect(daysText(-1)).toBe('yesterday');
    expect(daysText(5)).toBe('in 5 days');
    expect(daysText(-3)).toBe('3 days ago');
    expect(daysText(120)).toBe('in 4 months');
    expect(daysText(null)).toBe('');
  });

  it('writes durations and shares', () => {
    expect(duration(45)).toBe('45 min');
    expect(duration(150)).toBe('2 h 30 min');
    expect(duration(120)).toBe('2 h');
    expect(percent(0.256)).toBe('26%');
    expect(percent(null)).toBe('–');
  });

  it('reads typed numbers the Italian way too', () => {
    expect(numberOrNull('12,50')).toBe(12.5);
    expect(numberOrNull(' ')).toBeNull();
    expect(numberOrNull('abc')).toBeNull();
    expect(numberOrNull(7)).toBe(7);
    expect(textOrNull('  ')).toBeNull();
  });

  it('turns an API error into a sentence', () => {
    expect(
      errorText(
        { error: { issues: [{ path: 'title', message: 'Required' }] } },
        'x',
      ),
    ).toBe('title: Required');
    expect(errorText({ status: 0, error: null }, 'x', 'svc-money')).toBe(
      'svc-money is not reachable. Is it running (npm run dev)?',
    );
    expect(errorText({ status: 500, error: null }, 'Could not save it.')).toBe(
      'Could not save it.',
    );
  });
});
