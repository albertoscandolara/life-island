import type { DossierExpenseDto } from '@life-island/contracts';
import {
  expenseIdOfPayable,
  expensePayableKey,
  expensePayables,
} from './payables.js';

const expense = (over: Partial<DossierExpenseDto> = {}) =>
  ({
    id: '4f6b1c2e-1111-4222-8333-444455556666',
    issuer: 'Studio Dentistico Rossi',
    documentNumber: '12/A',
    description: 'Igiene dentale',
    date: '2026-06-01',
    amount: 90,
    ...over,
  }) as DossierExpenseDto;

const all = { from: '2026-01-01', to: '2026-12-31' };

describe('730 expense payables', () => {
  it('lists an expense with the days it can be paid on', () => {
    expect(expensePayables([expense()], all)).toEqual([
      {
        key: 'taxes:expense:4f6b1c2e-1111-4222-8333-444455556666',
        module: 'taxes',
        kind: 'expense',
        title: 'Studio Dentistico Rossi, invoice no. 12/A',
        payees: ['Studio Dentistico Rossi'],
        amount: 90,
        direction: 'out',
        date: '2026-06-01',
        window: { from: '2026-05-02', to: '2026-08-30' },
        path: '/taxes/730',
      },
    ]);
  });

  it('leaves out refunds and expenses outside the days asked', () => {
    expect(expensePayables([expense({ amount: -20 })], all)).toEqual([]);
    expect(
      expensePayables([expense()], { from: '2026-08-31', to: '2026-09-30' }),
    ).toEqual([]);
    expect(
      expensePayables([expense({ documentNumber: null })], all)[0].title,
    ).toBe('Studio Dentistico Rossi, Igiene dentale');
  });

  it('reads its own keys back, and nothing else', () => {
    const id = '4f6b1c2e-1111-4222-8333-444455556666';
    expect(expenseIdOfPayable(expensePayableKey(id))).toBe(id);
    expect(expenseIdOfPayable('home:bill:' + id)).toBeNull();
    expect(expenseIdOfPayable('taxes:expense:not-a-uuid')).toBeNull();
  });
});
