import { describe, expect, it } from 'vitest';
import type { OfferBaselineDto } from '@life-island/contracts';
import { parseAmount } from './labels';
import { compareOffer, type OfferDraft } from './tools-tab';

const baseline: OfferBaselineDto = {
  employer: 'Esempio Lavori',
  monthlySalary: 2300,
  monthsPaid: 13,
  ral: 29900,
  contributionRatePct: 9.19,
  surtaxRatePct: 2,
  surtaxSource: 'default',
  welfare12: 500,
  bonus12: 1000,
  net12: 23000,
};

const draft = (change: Partial<OfferDraft> = {}): OfferDraft => ({
  employer: 'Nuova Srl',
  ral: '',
  monthsPaid: '14',
  welfare: '',
  bonus: '',
  benefits: '',
  costs: '',
  ...change,
});

describe('parseAmount', () => {
  it('reads amounts as people type them', () => {
    expect(parseAmount('38.000')).toBe(38000);
    expect(parseAmount('38000')).toBe(38000);
    expect(parseAmount('38k')).toBe(38000);
    expect(parseAmount('€ 1.250,50')).toBe(1250.5);
    expect(parseAmount('')).toBeNull();
    expect(parseAmount('abc')).toBeNull();
  });
});

describe('compareOffer', () => {
  it('shows the current package alone until the offer has a RAL', () => {
    const { current, offer } = compareOffer(baseline, draft(), 2026);
    expect(offer).toBeNull();
    expect(current?.ral).toBe(29900);
    expect(current?.netMonthly).toBeCloseTo(current!.net / 13, 2);
    // Welfare as is, the bonus after tax.
    expect(current!.bonus).toBeGreaterThan(500);
    expect(current!.bonus).toBeLessThan(1000);
    expect(current!.total).toBeCloseTo(current!.net + 500 + current!.bonus, 2);
  });

  it('turns the offer into yearly net euros, less its extra costs', () => {
    const { current, offer } = compareOffer(
      baseline,
      draft({ ral: '35k', welfare: '1.000', costs: '1200' }),
      2026,
    );
    expect(offer!.ral).toBe(35000);
    expect(offer!.monthsPaid).toBe(14);
    expect(offer!.net).toBeGreaterThan(current!.net);
    expect(offer!.total).toBeCloseTo(offer!.net + 1000 - 1200, 2);
  });
});
