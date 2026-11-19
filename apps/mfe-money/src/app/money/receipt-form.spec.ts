import type {
  AccountDto,
  ReceiptReadingOutput,
  TransactionDto,
} from '@life-island/contracts';
import {
  defaultAccount,
  detailsRequest,
  emptyForm,
  formOf,
  formProblem,
  newMovementRequest,
  restOf,
  withReading,
} from './receipt-form';

const accounts = [
  { id: 'bank', kind: 'current', archived: false },
  { id: 'old-cash', kind: 'cash', archived: true },
  { id: 'wallet', kind: 'cash', archived: false },
] as AccountDto[];

const reading: ReceiptReadingOutput = {
  merchant: 'Amazon',
  date: '2026-11-11',
  total: 192.75,
  channel: 'online',
  category: 'groceries',
  splits: [{ category: 'shopping', amount: 27.99 }],
  note: 'Detergent, toilet paper, placemats €27.99',
  items: [],
};

const movement = {
  id: 'm',
  accountId: 'bank',
  date: '2026-11-13',
  amount: -192.75,
  description: 'AMAZON PAYMENTS',
  category: 'shopping',
  notes: null,
  splits: [],
  channel: null,
  attachments: [],
} as unknown as TransactionDto;

describe('the receipt form', () => {
  it('starts a cash receipt from the wallet', () => {
    expect(defaultAccount(accounts)).toBe('wallet');
    expect(emptyForm(accounts, '2026-11-19').accountId).toBe('wallet');
  });

  it('fills a new expense from the reading', () => {
    const form = withReading(emptyForm(accounts, '2026-11-19'), reading, true);
    expect(form).toMatchObject({
      date: '2026-11-11',
      paid: 192.75,
      description: 'Amazon',
      category: 'groceries',
      channel: 'online',
    });
    expect(restOf(form)).toBe(164.76);
    expect(formProblem(form, true)).toBeNull();
    expect(newMovementRequest(form)).toMatchObject({
      accountId: 'wallet',
      amount: -192.75,
      splits: [{ category: 'shopping', amount: 27.99 }],
    });
  });

  it("keeps the bank's day, amount and description on a movement", () => {
    const form = withReading(formOf(movement), reading, false);
    expect(form).toMatchObject({
      date: '2026-11-13',
      paid: 192.75,
      description: 'AMAZON PAYMENTS',
      category: 'groceries',
    });
    expect(detailsRequest(form)).toEqual({
      category: 'groceries',
      notes: 'Detergent, toilet paper, placemats €27.99',
      splits: [{ category: 'shopping', amount: 27.99 }],
      channel: 'online',
    });
  });

  it('says what is missing or wrong', () => {
    const empty = emptyForm(accounts, '2026-11-19');
    expect(formProblem(empty, true)).toMatch(/what you paid/);
    expect(formProblem(empty, false)).toBeNull();
    const over = {
      ...formOf(movement),
      splits: [{ category: 'health' as const, amount: 200 }],
    };
    expect(formProblem(over, false)).toMatch(/more than/);
  });
});
