import type { TransactionDto } from '@life-island/contracts';
import { detailsRequest, formOf, formProblem, restOf } from './details-form';

const movement = {
  id: 'm',
  accountId: 'bank',
  date: '2026-11-13',
  amount: -192.75,
  description: 'AMAZON PAYMENTS',
  category: 'groceries',
  notes: null,
  splits: [],
  channel: null,
  createdAt: '',
} as TransactionDto;

describe('the details of a movement', () => {
  it('starts from the movement as it is', () => {
    expect(formOf(movement)).toEqual({
      paid: 192.75,
      category: 'groceries',
      channel: null,
      notes: '',
      splits: [],
    });
  });

  it('keeps what the parts leave in the main category', () => {
    const form = {
      ...formOf(movement),
      splits: [{ category: 'shopping' as const, amount: 27.99 }],
    };
    expect(restOf(form)).toBe(164.76);
    expect(formProblem(form)).toBeNull();
    expect(
      formProblem({
        ...form,
        splits: [{ category: 'shopping', amount: 200 }],
      }),
    ).toMatch(/more than/);
    expect(
      formProblem({
        ...form,
        splits: [{ category: 'shopping', amount: null }],
      }),
    ).toMatch(/needs an amount/);
  });

  it('sends the note, the channel and only the real parts', () => {
    expect(
      detailsRequest({
        ...formOf(movement),
        notes: '  Detergent, placemats €27.99 ',
        channel: 'online',
        splits: [
          { category: 'shopping', amount: 27.994 },
          { category: 'groceries', amount: 10 },
        ],
      }),
    ).toEqual({
      category: 'groceries',
      notes: 'Detergent, placemats €27.99',
      splits: [{ category: 'shopping', amount: 27.99 }],
      channel: 'online',
    });
  });
});
