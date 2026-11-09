import { describe, expect, it } from 'vitest';
import {
  estimateDeductions,
  type EstimatedExpense,
} from './deduction-estimate.js';

const expense = (
  expenseType: string,
  amount: number,
  more: Partial<EstimatedExpense> = {},
): EstimatedExpense => ({
  taxYear: 2025,
  expenseType,
  amount,
  traceablePayment: true,
  beneficiaryFiscalCode: null,
  ...more,
});

describe('estimateDeductions', () => {
  it('takes the €129.11 franchigia once from all health expenses together', () => {
    const result = estimateDeductions(2025, [
      expense('medical', 200),
      expense('medicines', 129.11, { traceablePayment: false }),
    ]);
    const [health] = result.lines;
    expect(health.group).toBe('health');
    expect(health.spent).toBe(329.11);
    // Medicines paid in cash still count.
    expect(health.excluded).toBe(0);
    expect(health.eligible).toBe(200);
    expect(health.deduction).toBe(38);
    expect(health.cap).toBeNull();
  });

  it('leaves out a doctor paid in cash', () => {
    const [health] = estimateDeductions(2025, [
      expense('medical', 300, { traceablePayment: false }),
      expense('medical', 229.11),
    ]).lines;
    expect(health.excluded).toBe(300);
    expect(health.eligible).toBe(100);
  });

  it('stops veterinary expenses at €550 less the franchigia', () => {
    const [vet] = estimateDeductions(2025, [expense('veterinary', 900)]).lines;
    expect(vet.overCap).toBe(350);
    expect(vet.eligible).toBe(420.89);
    expect(vet.deduction).toBe(79.97);
    expect(vet.capUsage).toBeCloseTo(900 / 550);
  });

  it('gives each child their own sport cap', () => {
    const [sport] = estimateDeductions(2025, [
      expense('sport_kids', 300, { beneficiaryFiscalCode: 'AAA' }),
      expense('sport_kids', 150, { beneficiaryFiscalCode: 'bbb' }),
    ]).lines;
    expect(sport.people).toBe(2);
    expect(sport.effectiveCap).toBe(420);
    expect(sport.eligible).toBe(360);
  });

  it('spreads a renovation over ten years at 50% up to €96,000', () => {
    const result = estimateDeductions(2025, [expense('renovation', 120000)]);
    const [renovation] = result.lines;
    expect(renovation.rate).toBe(0.5);
    expect(renovation.reducedRate?.rate).toBe(0.36);
    expect(renovation.eligible).toBe(96000);
    expect(renovation.totalDeduction).toBe(48000);
    expect(renovation.deduction).toBe(4800);
    expect(result.futureYears).toBe(43200);
  });

  it('carries the instalments of earlier years into this 730', () => {
    const result = estimateDeductions(2025, [
      expense('renovation', 20000, { taxYear: 2023 }),
      expense('furniture', 6000, { taxYear: 2024 }),
      expense('renovation', 10000, { taxYear: 2014 }),
      expense('medical', 1000, { taxYear: 2024 }),
      expense('medical', 129.11),
    ]);
    expect(result.carried).toEqual([
      expect.objectContaining({
        fromYear: 2024,
        group: 'furniture',
        instalment: 2,
        of: 10,
        amount: 250,
      }),
      expect.objectContaining({
        fromYear: 2023,
        group: 'renovation',
        instalment: 3,
        amount: 1000,
      }),
    ]);
    // 2025 health is all franchigia; the 2014 works ended in 2023.
    expect(result.thisYear).toBe(1250);
  });

  it('does not estimate expenses of no known kind', () => {
    const [other] = estimateDeductions(2025, [expense('other', 500)]).lines;
    expect(other.rate).toBeNull();
    expect(other.deduction).toBe(0);
  });
});
