import {
  expenseKind,
  pairExpenses,
  type PairableExpense,
} from './expense-pairing.js';

let next = 0;
const expense = (
  date: string,
  issuer: string,
  text: string,
  amount: number,
  overrides: Partial<PairableExpense> = {},
): PairableExpense => ({
  id: `e${++next}`,
  taxYear: Number(date.slice(0, 4)),
  date,
  amount,
  issuer,
  text,
  pairedWith: null,
  pairing: null,
  ...overrides,
});

/** The 2025 expenses as they were approved: one per document. */
function year2025() {
  next = 0;
  return {
    unitycasaInvoice: expense(
      '2025-07-01',
      'Unitycasa di Romio Eddy',
      '2025 07 01 Unitycasa di Romio Eddy Compenso mediazione prima casa Fattura',
      3000,
    ),
    unitycasaTransfer: expense(
      '2025-07-01',
      'Unitycasa di Romio Eddy',
      '2025 07 01 Unitycasa di Romio Eddy Compenso mediazione prima casa Dettaglio bonifico',
      3002,
    ),
    lesoInvoice: expense(
      '2025-07-08',
      'LESO ELETTRODOMESTICI S.R.L.',
      '2025 07 08 0130 000234 LESO Condizionatori Fattura',
      4400,
    ),
    lesoTransfer: expense(
      '2025-07-14',
      'Banca Widiba',
      '2025 07 08 0130 000234 LESO Condizionatori Ricevuta Bonifico',
      4400,
    ),
    lesoWasher: expense(
      '2025-07-14',
      'Banca Widiba',
      '2025 07 14 0117 000316 LESO Lavatrice Ricevuta bonifico',
      280,
    ),
    idrotermReceipt: expense(
      '2025-11-03',
      'Banca Widiba',
      '2025 10 26 29 25 Idroterm Ricevuta bonifico',
      1265,
    ),
    idrotermDetail: expense(
      '2025-11-03',
      'Banca Widiba',
      '2025 10 26 29 25 Idroterm Dettaglio bonifico',
      1265,
    ),
    elektroHome: expense(
      '2025-11-26',
      'ELEKTROSYSTEM SNC DI C.DEGANI & F.PIGNOLETTI',
      '2025 11 26 240 Elektrosystem Fotovoltaico Fattura',
      9240,
    ),
    elektroEnergy: expense(
      '2025-12-10',
      'ELEKTROSYSTEM SNC DI C.DEGANI & F.PIGNOLETTI',
      '2025 12 10 260 Elektrosystem Fotovoltaico Fattura',
      9240,
    ),
    edilrensoInvoice: expense(
      '2025-12-16',
      'EDILRENSO SNC DI RENSO MASSIMO E C.',
      '2025 12 16 66 Edilrenso Fattura',
      55000,
    ),
    edilrenso15Detail: expense(
      '2025-12-19',
      'Edilrenso',
      '2025 12 16 66 15K Edilrenso Dettaglio bonifico agevolazione fiscale',
      15000,
    ),
    edilrenso15Receipt: expense(
      '2025-12-19',
      'Banca Widiba S.p.A.',
      '2025 12 16 66 15K Edilrenso Ricevuta bonifico agevolazione fiscale',
      15000,
    ),
    edilrenso40Receipt: expense(
      '2025-12-22',
      'Banca Widiba',
      '2025 12 16 66 40K Edilrenso Ricevuta bonifico agevolazione fiscale',
      40000,
    ),
    edilrenso40Detail: expense(
      '2025-12-22',
      'Banca Widiba',
      '2025 12 16 66 40K Edilrenso Dettaglio bonifico agevolazione fiscale',
      40000,
    ),
  };
}

const counted = (
  all: PairableExpense[],
  pairs: ReturnType<typeof pairExpenses>,
) => all.filter((e) => !pairs.has(e.id)).reduce((sum, e) => sum + e.amount, 0);

describe('pairing expenses', () => {
  it('tells invoices from transfer receipts', () => {
    const e = year2025();
    expect(expenseKind(e.lesoInvoice)).toBe('INVOICE');
    expect(expenseKind(e.lesoTransfer)).toBe('PAYMENT');
    expect(expenseKind(e.edilrenso15Detail)).toBe('PAYMENT');
    expect(expenseKind(e.elektroHome)).toBe('INVOICE');
    // An invoice that says how to pay it is still an invoice.
    expect(
      expenseKind({
        ...e.edilrensoInvoice,
        details:
          'Invoice n. 66 of 16/12/2025, to be paid by bank transfer (bonifico)',
      }),
    ).toBe('INVOICE');
    expect(
      expenseKind({
        issuer: 'Idroterm',
        text: '2025 10 26 Idroterm',
        details: 'Bank transfer receipt',
      }),
    ).toBe('PAYMENT');
  });

  it('counts each invoice once, with the transfers that paid it', () => {
    const e = year2025();
    const all = Object.values(e);
    const pairs = pairExpenses(all);

    expect(pairs.get(e.unitycasaTransfer.id)?.primaryId).toBe(
      e.unitycasaInvoice.id,
    );
    expect(pairs.get(e.lesoTransfer.id)?.primaryId).toBe(e.lesoInvoice.id);
    // 55.000 € paid as 15.000 € + 40.000 €, each with two receipts.
    for (const payment of [
      e.edilrenso15Detail,
      e.edilrenso15Receipt,
      e.edilrenso40Receipt,
      e.edilrenso40Detail,
    ])
      expect(pairs.get(payment.id)).toEqual({
        primaryId: e.edilrensoInvoice.id,
        automatic: true,
      });
    // Two receipts of one transfer, no invoice: counted once.
    expect(pairs.get(e.idrotermDetail.id)?.primaryId).toBe(
      e.idrotermReceipt.id,
    );
    // Two different invoices, and a transfer with no invoice: each on its own.
    for (const alone of [
      e.elektroHome,
      e.elektroEnergy,
      e.lesoWasher,
      e.unitycasaInvoice,
      e.lesoInvoice,
      e.edilrensoInvoice,
      e.idrotermReceipt,
    ])
      expect(pairs.has(alone.id)).toBe(false);

    const renovation = [
      e.lesoInvoice,
      e.lesoTransfer,
      e.idrotermReceipt,
      e.idrotermDetail,
      e.elektroHome,
      e.edilrensoInvoice,
      e.edilrenso15Detail,
      e.edilrenso15Receipt,
      e.edilrenso40Receipt,
      e.edilrenso40Detail,
    ];
    expect(renovation.reduce((sum, x) => sum + x.amount, 0)).toBe(185570);
    expect(counted(renovation, pairs)).toBe(69905);
  });

  it('keeps apart what you separated, and keeps what you confirmed', () => {
    const e = year2025();
    e.lesoTransfer.pairing = 'SEPARATE';
    e.lesoWasher.pairing = 'CONFIRMED';
    e.lesoWasher.pairedWith = e.lesoInvoice.id;
    const pairs = pairExpenses(Object.values(e));
    expect(pairs.has(e.lesoTransfer.id)).toBe(false);
    expect(pairs.get(e.lesoWasher.id)).toEqual({
      primaryId: e.lesoInvoice.id,
      automatic: false,
    });
  });

  it('never pairs across years, or a transfer that names another supplier', () => {
    next = 0;
    const invoice = expense(
      '2025-12-30',
      'Edilrenso',
      'Edilrenso Fattura',
      1000,
    );
    const nextYear = expense(
      '2026-01-05',
      'Banca Widiba',
      'Edilrenso Ricevuta bonifico',
      1000,
    );
    const other = expense(
      '2025-12-30',
      'Banca Widiba',
      'Idroterm Ricevuta bonifico',
      1000,
    );
    expect(pairExpenses([invoice, nextYear, other]).size).toBe(0);
  });
});
