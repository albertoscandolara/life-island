import { parseNumber } from './work-page';
import {
  duration,
  eventTone,
  periodText,
  safeUrl,
  valueText,
  workplaceName,
} from './labels';

describe('work labels', () => {
  it('writes durations, periods and values as you read them', () => {
    expect(duration(80)).toBe('6 years 8 months');
    expect(duration(1)).toBe('1 month');
    expect(duration(0)).toBe('less than a month');
    expect(periodText('2026-06')).toBe('Jun 2026');
    expect(periodText('2026-06-15')).toBe('15 Jun 2026');
    expect(valueText('contractKind', 'permanent')).toBe(
      'Permanent (tempo indeterminato)',
    );
    expect(valueText('partTimePercentage', 80)).toBe('80%');
    expect(valueText('monthlySalary', 2518.53)).toContain('2.518,53');
  });

  it('names a workplace by your label, else its employer', () => {
    expect(
      workplaceName({ label: null, values: { employerName: 'ACME SPA' } }),
    ).toBe('ACME SPA');
    expect(workplaceName({ label: 'Acme', values: {} })).toBe('Acme');
  });

  it('colours good news green and opens only web links', () => {
    expect(eventTone('promotion')).toBe('success');
    expect(eventTone('salary_cut')).toBe('danger');
    expect(safeUrl('https://www.linkedin.com/jobs/')).toBe(
      'https://www.linkedin.com/jobs/',
    );
    expect(safeUrl('javascript:alert(1)')).toBeNull();
  });

  it('reads numbers you type, Italian or not', () => {
    expect(parseNumber('2.518,53')).toBe(2518.53);
    expect(parseNumber('2518.53')).toBe(2518.53);
  });
});
