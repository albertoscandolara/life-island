import { sharePayments, type SharableExpense } from './shared-payments.js';

const LESO = 'LESO ELETTRODOMESTICI S.R.L.';
const fridge: SharableExpense = {
  id: 'fridge',
  date: '2026-05-06',
  amount: 550,
  issuer: LESO,
  text: '2026 05 06 0117 000319 LESO Frigo Ponzilovo Fattura',
  paymentUploads: [],
};
const washer: SharableExpense = {
  id: 'washer',
  date: '2026-05-25',
  amount: 304,
  issuer: LESO,
  text: '2026 05 25 0117 000292 LESO Lavatrice Ponzilovo Fattura',
  paymentUploads: ['transfer'],
};
const transfer = {
  amount: 854,
  text: 'LESO Lavatrice e Frigo Ponzilovo',
};

describe('sharePayments', () => {
  it('offers a transfer filed with one invoice to the others it adds up with', () => {
    expect(sharePayments([fridge, washer], () => transfer)).toEqual([
      {
        uploadId: 'transfer',
        expenseIds: ['washer', 'fridge'],
        suggestedFor: ['fridge'],
      },
    ]);
  });

  it('shows a transfer you filed with several invoices on each of them', () => {
    const filed = { ...fridge, paymentUploads: ['transfer'] };
    expect(
      sharePayments([filed, washer], () => ({ ...transfer, amount: null })),
    ).toEqual([
      {
        uploadId: 'transfer',
        expenseIds: ['fridge', 'washer'],
        suggestedFor: [],
      },
    ]);
  });

  it('does not offer it to an invoice that already has its payment proof', () => {
    const paid = { ...fridge, paymentUploads: ['own-transfer'] };
    expect(
      sharePayments([paid, washer], (id) =>
        id === 'transfer' ? transfer : { amount: 550, text: 'LESO Frigo' },
      ),
    ).toEqual([]);
  });

  it('does not offer it when nothing adds up', () => {
    expect(
      sharePayments([{ ...fridge, amount: 600 }, washer], () => transfer),
    ).toEqual([]);
  });

  it('does not offer it to another supplier', () => {
    const other = { ...fridge, issuer: 'Idroterm', text: 'Lavori idraulici' };
    expect(sharePayments([other, washer], () => transfer)).toEqual([]);
  });
});
