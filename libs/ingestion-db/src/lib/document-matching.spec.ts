import type { TransactionFacts } from '@life-island/contracts';
import { describe, expect, it } from 'vitest';
import {
  compareNames,
  proposeLinks,
  scorePair,
  type MatchDocument,
} from './document-matching.js';

const nobody = { name: null, vatNumber: null, taxCode: null, iban: null };

function facts(overrides: Partial<TransactionFacts>): TransactionFacts {
  return {
    role: 'INVOICE',
    documentKind: null,
    documentNumber: null,
    issueDate: null,
    dueDate: null,
    paymentDate: null,
    amount: null,
    fees: null,
    currency: 'EUR',
    counterparty: nobody,
    customer: nobody,
    references: [],
    paymentKind: null,
    description: null,
    subjects: [],
    ...overrides,
  };
}

/**
 * The sample pair: the notary's quote for the first home (Preventivo N. 0 of
 * 27/06/2025, 6,500.00, with the dedicated account stamped at the bottom)
 * and the SEPA transfer of 15/07/2025 "Saldo atto notarile prima casa ...
 * come da preventivo del 27 Giugno 2025". As the AI reads them.
 */
const notaryQuote = facts({
  role: 'QUOTE',
  documentKind: 'quote (preventivo)',
  documentNumber: '0',
  issueDate: '2025-06-27',
  amount: 6500,
  counterparty: {
    name: 'Notaio Bianchi Avv. Paolo',
    vatNumber: '00999888777',
    taxCode: 'BNC PLA 51A22 F839G',
    iban: 'IT 11 B 07601 11700 000000777888',
  },
  customer: {
    name: 'ROSSI MARIO',
    vatNumber: null,
    taxCode: 'RSSMRA80A01L781X',
    iban: null,
  },
  description:
    'Compravendita 218.000: notary fees, registration and cadastral taxes',
});

const notaryTransfer = facts({
  role: 'PAYMENT',
  documentKind: 'SEPA bank transfer',
  documentNumber: 'A100000000000000000000000001IT',
  issueDate: '2025-07-14',
  paymentDate: '2025-07-15',
  amount: 6500,
  fees: 0,
  counterparty: {
    name: 'Notaio Bianchi Avvocato Paolo',
    vatNumber: null,
    taxCode: null,
    iban: 'IT11B0760111700000000777888',
  },
  customer: {
    name: 'ROSSI MARIO',
    vatNumber: null,
    taxCode: null,
    iban: 'IT02A0300203280000000001234',
  },
  references: [{ kind: 'quote', number: null, date: '2025-06-27' }],
  paymentKind: 'BALANCE',
  description:
    'Saldo atto notarile prima casa in via Verdi 9 a Verona del 2 Luglio 2025 come da preventivo del 27 Giugno 2025',
  subjects: ['via Verdi 9, Verona'],
});

const doc = (uploadId: string, f: TransactionFacts): MatchDocument => ({
  uploadId,
  facts: f,
});

describe('compareNames', () => {
  it('sees through titles written out or abbreviated', () => {
    expect(
      compareNames(
        'Notaio Bianchi Avv. Paolo',
        'Notaio Bianchi Avvocato Paolo',
      ),
    ).toBe('strong');
    expect(compareNames('ENEL Energia S.p.A.', 'Enel Energia')).toBe('strong');
    expect(compareNames('Mario Rossi', 'Rossi Costruzioni Srl')).toBe('weak');
    expect(compareNames('Acme Srl', 'Globex Spa')).toBeNull();
  });
});

describe('scorePair', () => {
  it('ties the notary quote to its transfer by IBAN, amount, name and the quote date', () => {
    const pair = scorePair(notaryQuote, notaryTransfer);
    expect(pair.party).toBe('iban');
    expect(pair.amount).toBe('exact');
    expect(pair.reference).toBe('date');
    expect(pair.reasons).toEqual(
      expect.arrayContaining([
        "Paid to the supplier's IBAN (IT11B0760111700000000777888)",
        'Same amount (6,500.00)',
        'The payment names a quote of 27 Jun 2025, the date of this one',
        'Paid 18 days after it was issued',
      ]),
    );
    expect(pair.score).toBeGreaterThanOrEqual(15);
  });

  it('counts a bank fee or a rounding difference as the same amount', () => {
    const invoice = facts({
      amount: 120,
      counterparty: { ...nobody, name: 'Idraulica Bianchi' },
    });
    const withFee = scorePair(
      invoice,
      facts({
        role: 'PAYMENT',
        amount: 118.5,
        fees: 1.5,
        counterparty: { ...nobody, name: 'Idraulica Bianchi' },
      }),
    );
    expect(withFee.amount).toBe('close');
    const rounded = scorePair(
      invoice,
      facts({
        role: 'PAYMENT',
        amount: 120.4,
        counterparty: { ...nobody, name: 'Idraulica Bianchi' },
      }),
    );
    expect(rounded.amount).toBe('close');
  });

  it('finds the invoice number in the description even without a reference', () => {
    const pair = scorePair(
      facts({ documentNumber: 'FPR 2025/0147', amount: 300 }),
      facts({
        role: 'PAYMENT',
        amount: 300,
        description: 'Pagamento fattura FPR2025/0147',
      }),
    );
    expect(pair.reference).toBe('number');
  });

  it('never rules a pair out for its dates alone', () => {
    const late = scorePair(notaryQuote, {
      ...notaryTransfer,
      paymentDate: '2027-03-01',
    });
    expect(late.party).toBe('iban');
    expect(late.amount).toBe('exact');
    expect(late.score).toBeGreaterThan(10);
  });
});

describe('proposeLinks', () => {
  it('links the sample pair on its own, whichever was uploaded first', () => {
    const a = proposeLinks([doc('q', notaryQuote), doc('p', notaryTransfer)]);
    const b = proposeLinks([doc('p', notaryTransfer), doc('q', notaryQuote)]);
    expect(a).toEqual(b);
    expect(a).toEqual([
      expect.objectContaining({
        invoiceUploadId: 'q',
        paymentUploadId: 'p',
        status: 'AUTO',
      }),
    ]);
  });

  it('links the payment to the quote and to the invoice that followed it', () => {
    const invoice = facts({
      ...notaryQuote,
      role: 'INVOICE',
      documentNumber: '412/2025',
      issueDate: '2025-07-16',
    });
    const links = proposeLinks([
      doc('q', notaryQuote),
      doc('i', invoice),
      doc('p', notaryTransfer),
    ]);
    expect(links.map((l) => [l.invoiceUploadId, l.status])).toEqual([
      ['i', 'AUTO'],
      ['q', 'AUTO'],
    ]);
  });

  it('only suggests when two invoices fit the same payment equally well', () => {
    const supplier = {
      ...nobody,
      name: 'Enel Energia',
      vatNumber: 'IT06655971007',
    };
    const bill = (n: string, issued: string) =>
      facts({
        documentNumber: n,
        issueDate: issued,
        amount: 50,
        counterparty: supplier,
      });
    const links = proposeLinks([
      doc('jan', bill('1001', '2026-01-05')),
      doc('feb', bill('1002', '2026-02-05')),
      doc(
        'pay',
        facts({
          role: 'PAYMENT',
          paymentDate: '2026-01-25',
          amount: 50,
          counterparty: { ...supplier, vatNumber: null },
        }),
      ),
    ]);
    expect(links).toHaveLength(2);
    expect(links.every((link) => link.status === 'SUGGESTED')).toBe(true);
    expect(links[0].reasons[0]).toMatch(/2 invoices could match/);
  });

  it('decides with an invoice number in the description', () => {
    const supplier = { ...nobody, name: 'Enel Energia' };
    const bill = (n: string, issued: string) =>
      facts({
        documentNumber: n,
        issueDate: issued,
        amount: 50,
        counterparty: supplier,
      });
    const links = proposeLinks([
      doc('jan', bill('20261001', '2026-01-05')),
      doc('feb', bill('20261002', '2026-02-05')),
      doc(
        'pay',
        facts({
          role: 'PAYMENT',
          amount: 50,
          counterparty: supplier,
          description: 'Bolletta n. 20261002',
        }),
      ),
    ]);
    expect(links).toEqual([
      expect.objectContaining({ invoiceUploadId: 'feb', status: 'AUTO' }),
    ]);
  });

  it('links one payment to the invoices it settles together', () => {
    const supplier = {
      ...nobody,
      name: 'Studio Tecnico Verdi',
      iban: 'IT60X0542811101000000123456',
    };
    const links = proposeLinks([
      doc(
        'a',
        facts({
          documentNumber: '11',
          amount: 200,
          issueDate: '2026-03-01',
          counterparty: supplier,
        }),
      ),
      doc(
        'b',
        facts({
          documentNumber: '12',
          amount: 350.5,
          issueDate: '2026-03-10',
          counterparty: supplier,
        }),
      ),
      doc(
        'c',
        facts({
          documentNumber: '13',
          amount: 999,
          issueDate: '2026-03-12',
          counterparty: supplier,
        }),
      ),
      doc(
        'pay',
        facts({
          role: 'PAYMENT',
          amount: 550.5,
          paymentDate: '2026-03-20',
          counterparty: supplier,
        }),
      ),
    ]);
    expect(links.map((l) => [l.invoiceUploadId, l.status]).sort()).toEqual([
      ['a', 'AUTO'],
      ['b', 'AUTO'],
    ]);
    expect(links[0].reasons[0]).toBe(
      'Pays 2 invoices together: 200.00 + 350.50 = 550.50',
    );
  });

  it('links an advance and a balance that add up to the invoice', () => {
    const supplier = {
      ...nobody,
      name: 'Serramenti Neri',
      vatNumber: '01234567890',
    };
    const invoice = facts({
      documentNumber: '77',
      amount: 3000,
      issueDate: '2026-05-02',
      counterparty: supplier,
      description: 'Finestre casa Tregnago',
    });
    const pay = (amount: number, date: string) =>
      facts({
        role: 'PAYMENT',
        amount,
        paymentDate: date,
        counterparty: { ...supplier, vatNumber: null },
      });
    const links = proposeLinks([
      doc('inv', invoice),
      doc('p1', pay(1000, '2026-04-01')),
      doc('p2', pay(2000, '2026-05-20')),
    ]);
    expect(links.map((l) => [l.paymentUploadId, l.status]).sort()).toEqual([
      ['p1', 'AUTO'],
      ['p2', 'AUTO'],
    ]);
  });

  it('links a labelled advance that names what it pays for', () => {
    const supplier = { ...nobody, name: 'Serramenti Neri' };
    const links = proposeLinks([
      doc(
        'inv',
        facts({
          amount: 3000,
          counterparty: supplier,
          description: 'Finestre casa Tregnago',
        }),
      ),
      doc(
        'p1',
        facts({
          role: 'PAYMENT',
          amount: 1000,
          paymentKind: 'ADVANCE',
          counterparty: supplier,
          description: 'Acconto finestre Tregnago',
        }),
      ),
    ]);
    expect(links).toEqual([expect.objectContaining({ status: 'AUTO' })]);
  });

  it('only suggests a partial payment that nothing else explains', () => {
    const supplier = {
      ...nobody,
      name: 'Serramenti Neri',
      vatNumber: '01234567890',
    };
    const links = proposeLinks([
      doc('inv', facts({ amount: 3000, counterparty: supplier })),
      doc(
        'p1',
        facts({ role: 'PAYMENT', amount: 1000, counterparty: supplier }),
      ),
    ]);
    expect(links).toEqual([expect.objectContaining({ status: 'SUGGESTED' })]);
  });

  it('suggests rather than links two payments of one invoice that add up to more than it', () => {
    const supplier = {
      ...nobody,
      name: 'Enel Energia',
      vatNumber: '06655971007',
    };
    const links = proposeLinks([
      doc(
        'jan',
        facts({ amount: 50, issueDate: '2026-01-05', counterparty: supplier }),
      ),
      doc(
        'p1',
        facts({
          role: 'PAYMENT',
          amount: 50,
          paymentDate: '2026-01-20',
          counterparty: supplier,
        }),
      ),
      doc(
        'p2',
        facts({
          role: 'PAYMENT',
          amount: 50,
          paymentDate: '2026-02-20',
          counterparty: supplier,
        }),
      ),
    ]);
    expect(links).toHaveLength(2);
    expect(links.every((link) => link.status === 'SUGGESTED')).toBe(true);
  });

  it('leaves alone what you decided', () => {
    const docs = [doc('q', notaryQuote), doc('p', notaryTransfer)];
    expect(
      proposeLinks(docs, [
        { invoiceUploadId: 'q', paymentUploadId: 'p', status: 'REJECTED' },
      ]),
    ).toEqual([]);
    expect(
      proposeLinks(docs, [
        { invoiceUploadId: 'q', paymentUploadId: 'p', status: 'CONFIRMED' },
      ]),
    ).toEqual([]);
  });

  it('does not match on amount alone', () => {
    const links = proposeLinks([
      doc(
        'inv',
        facts({ amount: 50, counterparty: { ...nobody, name: 'Acme Srl' } }),
      ),
      doc(
        'pay',
        facts({
          role: 'PAYMENT',
          amount: 50,
          counterparty: { ...nobody, name: 'Globex Spa' },
        }),
      ),
    ]);
    expect(links).toEqual([]);
  });

  it('ignores documents that are neither invoices nor payments', () => {
    expect(
      proposeLinks([
        doc(
          'x',
          facts({
            role: 'NONE',
            amount: 6500,
            counterparty: notaryQuote.counterparty,
          }),
        ),
        doc('p', notaryTransfer),
      ]),
    ).toEqual([]);
  });
});
