import type { BillDto } from '@life-island/contracts';
import { billPayment } from './bills.service.js';
import { billPayables } from './payables.js';
import type { PaymentRow } from '../db/schema.js';

const bill = (over: Partial<BillDto> = {}): BillDto => ({
  id: 'b1',
  uploadId: 'u1',
  title: 'Bolletta luce',
  utility: 'ELECTRICITY',
  utilityOverridden: false,
  propertyId: null,
  assignment: null,
  provider: 'Enel Energia',
  customerId: null,
  periodStart: '2026-09-01',
  periodEnd: '2026-10-31',
  issueDate: '2026-11-02',
  dueDate: '2026-11-20',
  amount: 90,
  currency: 'EUR',
  consumption: null,
  unit: 'kWh',
  fee: null,
  invoiceNumber: '123',
  totalDue: 84.37,
  supplierId: 's1',
  supplyPointId: null,
  contractId: null,
  directDebit: true,
  autoPaid: true,
  bankPayment: null,
  ...over,
});

const suppliers = new Map([
  [
    's1',
    { name: 'Enel Energia S.p.A.', aliases: ['Servizio Elettrico Nazionale'] },
  ],
]);
const all = { from: '2026-01-01', to: '2026-12-31' };

describe('bill payables', () => {
  it('lists what is due, to whom, and when it can be paid', () => {
    expect(billPayables([bill()], suppliers, all)).toEqual([
      {
        key: 'home:bill:u1',
        module: 'home',
        kind: 'bill',
        title: 'Enel Energia, electricity bill no. 123',
        payees: [
          'Enel Energia',
          'Enel Energia S.p.A.',
          'Servizio Elettrico Nazionale',
        ],
        amount: 84.37,
        direction: 'out',
        date: '2026-11-20',
        window: { from: '2026-10-30', to: '2027-01-04' },
        autoPay: true,
        path: '/home/bills',
      },
    ]);
  });

  it('leaves out credit notes, bills with no date, and bills outside the days asked', () => {
    expect(
      billPayables(
        [
          bill({ totalDue: 0 }),
          bill({ totalDue: null, amount: -12 }),
          bill({ dueDate: null, issueDate: null }),
        ],
        suppliers,
        all,
      ),
    ).toEqual([]);
    expect(
      billPayables([bill()], suppliers, {
        from: '2027-01-05',
        to: '2027-02-01',
      }),
    ).toEqual([]);
    expect(
      billPayables([bill()], suppliers, {
        from: '2027-01-04',
        to: '2027-02-01',
      }),
    ).toHaveLength(1);
  });

  it('looks 40 days back when the bill has no issue date', () => {
    const [p] = billPayables([bill({ issueDate: null })], new Map(), all);
    expect(p.window.from).toBe('2026-10-11');
    expect(p.payees).toEqual(['Enel Energia']);
  });
});

describe('bill payment', () => {
  const row = (over: Partial<PaymentRow>): PaymentRow => ({
    linkId: 'l1',
    payableKey: 'home:bill:u1',
    amount: 40,
    paidOn: '2026-11-10',
    accountName: 'Current account',
    description: 'BONIFICO',
    unlinkedAt: null,
    createdAt: new Date(),
    ...over,
  });

  it('adds up the matched movements still linked', () => {
    expect(billPayment(84.37, [])).toBeNull();
    expect(
      billPayment(84.37, [
        row({}),
        row({ linkId: 'l2', amount: 44.37, paidOn: '2026-11-12' }),
        row({ linkId: 'l3', amount: 10, unlinkedAt: new Date() }),
      ]),
    ).toEqual({
      paid: 84.37,
      full: true,
      lastDate: '2026-11-12',
      accounts: ['Current account'],
    });
    expect(billPayment(84.37, [row({})])?.full).toBe(false);
  });
});
