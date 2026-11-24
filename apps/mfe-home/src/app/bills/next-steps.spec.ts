import type { BillDto } from '@life-island/contracts';
import { describe, expect, it } from 'vitest';
import { byUrgency, utilityStep } from './next-steps';

const bill = (over: Partial<BillDto>): BillDto => ({
  id: Math.random().toString(36),
  uploadId: Math.random().toString(36),
  title: 'Bill',
  utility: 'ELECTRICITY',
  utilityOverridden: false,
  propertyId: 'p1',
  assignment: 'SUPPLY_CODE',
  provider: 'ENEL ENERGIA',
  customerId: null,
  periodStart: '2026-09-01',
  periodEnd: '2026-10-31',
  issueDate: '2026-11-02',
  dueDate: null,
  amount: 80,
  currency: 'EUR',
  consumption: 300,
  unit: 'kWh',
  fee: null,
  invoiceNumber: null,
  totalDue: null,
  supplierId: 's1',
  supplierName: 'Enel Energia S.p.A.',
  supplyPointId: 'pod',
  contractId: 'c1',
  directDebit: null,
  autoPaid: false,
  bankPayment: null,
  ...over,
});

const context = { today: '2026-11-24', change: null, missing: [] };

describe('the next step of a utility', () => {
  it('asks to pay a bill past its due date first, by its company name', () => {
    const step = utilityStep(
      'ELECTRICITY',
      [
        bill({ dueDate: '2026-12-10' }),
        bill({ dueDate: '2026-11-15', amount: 64.5 }),
      ],
      context,
    );
    expect(step.level).toBe('late');
    expect(step.heading).toContain('Enel Energia S.p.A.');
    expect(step.date).toBe('2026-11-15');
  });

  it('never asks for a bill paid by direct debit or matched in Money', () => {
    const step = utilityStep(
      'ELECTRICITY',
      [
        bill({ dueDate: '2026-12-10', autoPaid: true }),
        bill({
          dueDate: '2026-11-15',
          bankPayment: {
            paid: 80,
            full: true,
            lastDate: '2026-11-14',
            accounts: [],
          } as unknown as BillDto['bankPayment'],
        }),
      ],
      context,
    );
    expect(step.level).toBe('ok');
    expect(step.detail).toContain('direct debit');
  });

  it('forgets a bill late for more than a month: paid outside Money', () => {
    const step = utilityStep(
      'ELECTRICITY',
      [bill({ dueDate: '2026-09-01' })],
      context,
    );
    expect(step.level).toBe('ok');
  });

  it('asks for missing internet bills, then to compare offers on a rise', () => {
    const missing = [
      {
        key: 'line',
        provider: 'Wind Tre S.p.A.',
        propertyId: 'p1',
        months: ['2026-02'],
      },
    ];
    expect(
      utilityStep('INTERNET', [bill({ utility: 'INTERNET' })], {
        ...context,
        missing,
      }).level,
    ).toBe('missing');
    const rising = utilityStep('GAS', [bill({ utility: 'GAS' })], {
      ...context,
      change: 0.2,
    });
    expect(rising.level).toBe('rising');
    expect(rising.heading).toBe('Compare offers: price +20%');
    // Water has one operator: no offers to compare.
    expect(
      utilityStep('WATER', [bill({ utility: 'WATER' })], {
        ...context,
        change: 0.2,
      }).heading,
    ).toContain('readings');
  });

  it('puts what is late before what is due before what is in order', () => {
    const steps = [
      utilityStep('GAS', [bill({ utility: 'GAS' })], context),
      utilityStep('WATER', [], context),
      utilityStep('ELECTRICITY', [bill({ dueDate: '2026-12-01' })], context),
      utilityStep(
        'INTERNET',
        [bill({ utility: 'INTERNET', dueDate: '2026-11-20' })],
        context,
      ),
    ].sort(byUrgency);
    expect(steps.map((s) => [s.utility, s.level])).toEqual([
      ['INTERNET', 'late'],
      ['ELECTRICITY', 'due'],
      ['WATER', 'empty'],
      ['GAS', 'ok'],
    ]);
  });
});
