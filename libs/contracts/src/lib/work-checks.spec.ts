import { describe, expect, it } from 'vitest';
import {
  compareTfrChoice,
  pensionDeductionLimit,
  pensionFundBenefitTaxPct,
  tfrRevaluation,
  tfrSeparateTaxRate,
  vacationHoursPerYear,
} from './work-checks.js';

describe('CCNL rules', () => {
  it('gives vacation by years at the company', () => {
    expect(vacationHoursPerYear(3)).toBe(160);
    expect(vacationHoursPerYear(12)).toBe(168);
    expect(vacationHoursPerYear(20)).toBe(200);
  });
});

describe('TFR', () => {
  it('uses the official revaluation, else estimates it', () => {
    expect(tfrRevaluation(2022)).toEqual({ pct: 9.974576, estimated: false });
    // 2026: 1.5% plus 75% of the year's 2.5% inflation.
    expect(tfrRevaluation(2026)).toEqual({ pct: 3.38, estimated: true });
  });

  it('taxes a TFR paid by the company at the average rate of its reference income', () => {
    // 10 years of 2,000 a year: reference income 24,000, all at 23%.
    expect(tfrSeparateTaxRate(20000, 10, 2026)).toBe(23);
    expect(tfrSeparateTaxRate(0, 10, 2026)).toBe(0);
  });
});

describe('pension fund rules', () => {
  it('has the deduction limit of each year', () => {
    expect(pensionDeductionLimit(2025)).toBe(5164.57);
    expect(pensionDeductionLimit(2026)).toBe(5300);
  });

  it('lowers the benefit tax after 15 years, down to 9%', () => {
    expect(pensionFundBenefitTaxPct(10)).toBe(15);
    expect(pensionFundBenefitTaxPct(25)).toBeCloseTo(12, 5);
    expect(pensionFundBenefitTaxPct(40)).toBe(9);
  });

  it('compares the TFR kept by the company with a pension fund', () => {
    const result = compareTfrChoice({
      ral: 32000,
      years: 30,
      startingTfr: 0,
      employeePct: 1.2,
      employerPct: 2,
      fundReturnPct: 3,
      inflationPct: 2,
      salaryGrowthPct: 0,
      year: 2026,
    });
    // 1.5% + 75% of 2%, less 17%.
    expect(result.companyRatePct).toBe(2.49);
    expect(result.fund.paidIn).toBeCloseTo(32000 * 0.012 * 30, 0);
    expect(result.fund.employerPaidIn).toBeCloseTo(32000 * 0.02 * 30, 0);
    expect(result.fund.taxPct).toBe(10.5);
    expect(result.fund.net).toBeGreaterThan(result.company.net);
    expect(result.fund.taxSaved).toBeGreaterThan(0);
  });

  it('keeps the TFR already set aside in the company in both cases', () => {
    const base = {
      ral: 30000,
      years: 10,
      employeePct: 0,
      employerPct: 0,
      fundReturnPct: 2.49,
      inflationPct: 2,
      salaryGrowthPct: 0,
      year: 2026,
    };
    const without = compareTfrChoice({ ...base, startingTfr: 0 });
    const withOld = compareTfrChoice({ ...base, startingTfr: 10000 });
    expect(withOld.company.gross - without.company.gross).toBeCloseTo(
      withOld.fund.gross - without.fund.gross,
      0,
    );
  });
});
