import { describe, expect, it } from 'vitest';
import { guideText, PENSION_GUIDE } from './pension-guide';
import {
  fundRequest,
  paymentRequest,
  percentOf,
  statementRequest,
  type FundDraft,
} from './pension-tab';

const fund: FundDraft = {
  id: null,
  name: '  Fondo Cometa ',
  kind: 'negotiated',
  memberSince: '2016-03-01',
  investmentLine: '',
  employeePct: '1,2',
  employerPct: '2%',
  tfrPct: '100',
  firstJob: true,
  memberCode: '',
  url: '',
  notes: '',
  active: true,
};

describe('pension tab drafts', () => {
  it('reads percentages as people type them', () => {
    expect(percentOf('1,2')).toBe(1.2);
    expect(percentOf('2%')).toBe(2);
    expect(percentOf('')).toBe(null);
    expect(percentOf('abc')).toBe(null);
  });

  it('turns a fund draft into its request', () => {
    expect(fundRequest(fund)).toEqual({
      name: 'Fondo Cometa',
      kind: 'negotiated',
      memberSince: '2016-03-01',
      investmentLine: null,
      employeePct: 1.2,
      employerPct: 2,
      tfrPct: 100,
      firstJob: true,
      memberCode: null,
      url: null,
      notes: null,
      status: 'active',
    });
  });

  it('needs a date and a value for a statement, an amount for a transfer', () => {
    const base = {
      fundId: 'f1',
      date: '2025-12-31',
      value: '',
      paidIn: '',
      employee: '',
      employer: '',
      tfr: '',
      returnPct: '',
    };
    expect(statementRequest(base)).toBe(null);
    expect(statementRequest({ ...base, value: '24.500,00' })).toMatchObject({
      value: 24500,
      paidIn: null,
    });
    const payment = {
      fundId: 'f1',
      date: '2026-12-20',
      amount: '',
      kind: 'direct' as const,
      note: '',
    };
    expect(paymentRequest(payment)).toBe(null);
    expect(paymentRequest({ ...payment, amount: '1.000' })).toMatchObject({
      amount: 1000,
      note: null,
    });
  });

  it('writes the limits into the guide', () => {
    const tax = PENSION_GUIDE.find((s) => s.id === 'tax')!;
    const text = guideText(tax.body[0], {
      limit: '5.300,00 €',
      oldLimit: '5.164,57 €',
    });
    expect(text).toContain('up to 5.300,00 € a year (5.164,57 € until 2025)');
    expect(text).not.toContain('{');
  });
});
