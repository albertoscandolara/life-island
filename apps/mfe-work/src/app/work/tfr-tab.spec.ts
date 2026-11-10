import { describe, expect, it } from 'vitest';
import { tfrChoice, type TfrChoiceDraft } from './tfr-tab';

const draft = (change: Partial<TfrChoiceDraft> = {}): TfrChoiceDraft => ({
  ral: '32000',
  years: '30',
  startingTfr: '10000',
  employeePct: '1.2',
  employerPct: '2',
  fundReturnPct: '3',
  inflationPct: '2',
  salaryGrowthPct: '1',
  ...change,
});

describe('tfrChoice', () => {
  it('waits for the RAL and the years', () => {
    expect(tfrChoice(draft({ ral: '' }), 2026)).toBeNull();
    expect(tfrChoice(draft({ years: '0' }), 2026)).toBeNull();
  });

  it('reads percentages with a comma', () => {
    const dot = tfrChoice(draft(), 2026);
    const comma = tfrChoice(draft({ employeePct: '1,2' }), 2026);
    expect(comma).toEqual(dot);
  });

  it('favours the fund when the employer pays in and returns beat the TFR', () => {
    const result = tfrChoice(draft(), 2026);
    expect(result?.fund.employerPaidIn).toBeGreaterThan(0);
    expect(result?.difference).toBeGreaterThan(0);
  });
});
