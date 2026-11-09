import { describe, expect, it } from 'vitest';
import {
  ccnlMinimum,
  ccnlTableFor,
  employeeDeduction,
  estimateNet,
  foiIndex,
  goalKey,
  grossIrpef,
  marginalBracket,
  nextCcnlLevel,
  wedgeCut,
} from './work-insights.js';

describe('foiIndex', () => {
  it('chains the yearly changes from 2015 = 100', () => {
    expect(foiIndex(2015)).toBe(100);
    expect(foiIndex(2016)).toBe(99.9);
    // 2022 alone is +8%.
    expect(foiIndex(2022)! / foiIndex(2021)!).toBeCloseTo(1.08, 3);
  });

  it('is null outside the table', () => {
    expect(foiIndex(2014)).toBeNull();
    expect(foiIndex(2099)).toBeNull();
  });
});

describe('CCNL tables', () => {
  it('finds the Metalmeccanici industria table as payslips print it', () => {
    expect(ccnlTableFor('Metalmeccanici Industria Impiegati')?.id).toBe(
      'metalmeccanici-industria',
    );
    expect(ccnlTableFor('METALMECCANICA ARTIGIANATO')).toBeNull();
    expect(ccnlTableFor('Commercio terziario')).toBeNull();
    expect(ccnlTableFor(null)).toBeNull();
  });

  it('gives the minimum in force in a month', () => {
    const table = ccnlTableFor('Metalmeccanici industria')!;
    expect(ccnlMinimum(table, 'C3', '2025-05')).toBe(2130.56);
    expect(ccnlMinimum(table, 'C3', '2025-06')).toBe(2158.26);
    expect(ccnlMinimum(table, 'C3', '2026-11')).toBe(2211.43);
    expect(ccnlMinimum(table, 'C3', '2020-01')).toBeNull();
    expect(ccnlMinimum(table, 'Z9', '2026-11')).toBeNull();
  });

  it('knows the level above', () => {
    const table = ccnlTableFor('Metalmeccanici industria')!;
    expect(nextCcnlLevel(table, 'C3')).toBe('B1');
    expect(nextCcnlLevel(table, 'A1')).toBeNull();
    expect(nextCcnlLevel(table, '5')).toBeNull();
  });
});

describe('IRPEF', () => {
  it('applies the brackets of each year', () => {
    // 2022: 15,000 at 23% + 13,000 at 25% + 2,000 at 35%.
    expect(grossIrpef(30000, 2022)).toBe(3450 + 3250 + 700);
    // 2024: 28,000 at 23% + 2,000 at 35%.
    expect(grossIrpef(30000, 2024)).toBe(6440 + 700);
    // 2026: the second bracket is 33%.
    expect(grossIrpef(30000, 2026)).toBe(6440 + 660);
  });

  it('says the bracket and how far its top is', () => {
    expect(marginalBracket(27000, 2026)).toEqual({
      ratePct: 23,
      upTo: 28000,
      toNext: 1000,
    });
    expect(marginalBracket(60000, 2026).ratePct).toBe(43);
    expect(marginalBracket(60000, 2026).toNext).toBeNull();
  });

  it('computes the employee deduction and the wedge cut', () => {
    expect(employeeDeduction(10000)).toBe(1955);
    expect(employeeDeduction(28000)).toBe(1910 + 65);
    expect(employeeDeduction(60000)).toBe(0);
    expect(wedgeCut(8000)).toEqual({ taxFreeSum: 568, extraDeduction: 0 });
    expect(wedgeCut(25000)).toEqual({ taxFreeSum: 0, extraDeduction: 1000 });
    expect(wedgeCut(36000).extraDeduction).toBe(500);
  });

  it('estimates the net of a RAL', () => {
    const net = estimateNet({
      ral: 30000,
      contributionRatePct: 9.19,
      surtaxRatePct: 2,
      year: 2026,
    });
    expect(net.contributions).toBe(2757);
    expect(net.taxable).toBe(27243);
    expect(net.net).toBeCloseTo(23476.54, 0);
    expect(net.wedgePct).toBeCloseTo(21.7, 1);
  });
});

describe('goalKey', () => {
  it('normalizes a goal to compare it across reads', () => {
    expect(goalKey('  Certificazione AWS — entro Giugno! ')).toBe(
      'certificazione aws entro giugno',
    );
    expect(goalKey('Più qualità')).toBe('piu qualita');
  });
});
