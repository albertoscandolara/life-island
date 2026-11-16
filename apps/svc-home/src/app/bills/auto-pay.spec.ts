import { contractDirectDebit, isAutoPaid } from './auto-pay.js';
import { readDirectDebit } from './bill-reader.js';

describe('readDirectDebit', () => {
  it.each([
    'Domiciliazione bancaria',
    'Addebito diretto SEPA (SDD)',
    'addebito su c/c',
    'RID bancario',
    'payment_method.sepa_direct_debit',
  ])('reads "%s" as a direct debit', (method) => {
    expect(readDirectDebit({ payment_method: method })).toBe(true);
  });

  it('reads another printed method as not a direct debit', () => {
    expect(readDirectDebit({ metodo_pagamento: 'Bollettino postale' })).toBe(
      false,
    );
  });

  it('says nothing when the bill prints no method', () => {
    expect(readDirectDebit({ total_amount: 80 })).toBeNull();
    expect(
      readDirectDebit({ payment_due_date: '2026-11-01', payment_method: '' }),
    ).toBeNull();
  });
});

describe('auto-paid bills', () => {
  const bill = (
    contractId: string | null,
    directDebit: boolean | null,
    issueDate: string,
  ) => ({ contractId, directDebit, issueDate, periodEnd: null, dueDate: null });

  it('follows the latest bill of a contract that prints a method', () => {
    const detected = contractDirectDebit([
      bill('c1', false, '2026-01-10'),
      bill('c1', true, '2026-05-10'),
      bill('c1', null, '2026-09-10'),
      bill('c2', false, '2026-02-10'),
      bill(null, true, '2026-02-10'),
    ]);
    expect(detected.get('c1')).toBe(true);
    expect(detected.get('c2')).toBe(false);
    expect(detected.size).toBe(2);
  });

  it('lets your choice on the contract win, then the bill, then the contract', () => {
    expect(isAutoPaid({ directDebit: false }, true, false)).toBe(true);
    expect(isAutoPaid({ directDebit: true }, false, true)).toBe(false);
    expect(isAutoPaid({ directDebit: false }, null, true)).toBe(false);
    expect(isAutoPaid({ directDebit: null }, null, true)).toBe(true);
    expect(isAutoPaid({ directDebit: null }, null, undefined)).toBe(false);
  });
});
