import { findTarget } from '@life-island/contracts';
import { buildExtractionPlan } from '../templates.js';
import type { CategoryDefinition, ParseInput } from './document-parser.js';
import { QuotaExhaustedError } from './document-parser.js';
import { companyNameIn, FakeParser, monthPeriod } from './fake-parser.js';

const categories: CategoryDefinition[] = [
  'GROCERIES',
  'RECEIPT',
  'EXPENSE',
  'MEDICAL',
  'BILL',
].map((id) => ({
  id,
  title: id,
  description: id,
  template: {
    fields: [
      {
        key: 'total_amount',
        label: 'Total',
        type: 'amount',
        description: '',
        required: true,
      },
      {
        key: 'currency',
        label: 'Currency',
        type: 'currency',
        description: '',
        required: false,
      },
      {
        key: 'issue_date',
        label: 'Issue date',
        type: 'date',
        description: '',
        required: false,
      },
      {
        key: 'supplier_name',
        label: 'Supplier',
        type: 'string',
        description: '',
        required: false,
      },
    ],
  },
}));

const inputOf = (
  filename: string,
  text = '',
  description: string | null = null,
): ParseInput => ({
  document: { kind: 'text', text },
  filename,
  title: filename,
  description,
});

describe('FakeParser', () => {
  const parser = new FakeParser();

  it.each([
    [
      'scontrino-esselunga.jpg',
      'grocery.receipt@1',
      ['GROCERIES', 'RECEIPT', 'EXPENSE'],
    ],
    ['farmacia.pdf', 'tax730.expense@1', ['MEDICAL']],
    ['contract.pdf', 'general.document@1', []],
  ])(
    'classifies %s as %s with matching existing categories',
    async (filename, targetKey, ids) => {
      const { result } = await parser.classify(inputOf(filename), categories);
      expect(result).toMatchObject({ targetKey, flags: ['fake_parser'] });
      expect([...result.categoryIds].sort()).toEqual([...ids].sort());
    },
  );

  it('reads only what the text shows and leaves the rest missing', async () => {
    const plan = buildExtractionPlan(
      categories.slice(0, 1),
      'grocery.receipt@1',
    );
    const { result } = await parser.extract(
      inputOf('scan.txt', 'CONAD 12/10/2026 TOTALE EUR 12,40'),
      plan,
    );
    expect(result.fields.fields).toMatchObject({
      total_amount: { status: 'found', value: 12.4 },
      currency: { status: 'found', value: 'EUR' },
      issue_date: { status: 'found', value: '2026-10-12' },
      supplier_name: { status: 'missing', value: null },
    });
    expect(
      findTarget('grocery.receipt@1')?.schema.safeParse(result.details).success,
    ).toBe(true);
  });

  it('suggests an issuer category it recognizes', async () => {
    const { result } = await parser.discover(
      inputOf('Bolletta ENEL luce.pdf'),
      {
        categories,
        pending: [],
        rejectedIds: [],
        analysis: {
          documentType: 'bill',
          purpose: '',
          characteristics: [],
          issuer: null,
          language: 'it',
          summary: '',
          categoryEvidence: [],
          confidence: 0.5,
          warnings: [],
        },
        assignedIds: ['BILL'],
      },
    );
    expect(result.suggestions.map((s) => s.id).sort()).toEqual([
      'ELECTRICITY_BILL',
      'ENEL',
    ]);
  });

  it('simulates a usage quota with a known reset time', async () => {
    const limited = new FakeParser({ steps: 1, periodMinutes: 60 });
    await limited.classify(inputOf('a.txt'), categories);
    const error = await limited
      .classify(inputOf('b.txt'), categories)
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(QuotaExhaustedError);
    expect((error as QuotaExhaustedError).resetAt!.getTime()).toBeGreaterThan(
      Date.now(),
    );
  });
});

describe('FakeParser on a payslip PDF', () => {
  // Anonymized: the layout of an Italian LUL, with made-up names and numbers.
  const payslip: ParseInput = {
    document: {
      kind: 'pdf',
      data: Buffer.from('%PDF'),
      text: [
        'POS. INPS  MESE DI RETRIBUZIONE',
        'MARZO 2026',
        'ESEMPIO LAVORI S.R.L.',
        'VIA ROMA 1  38121 TRENTO (TN)',
        'COGNOME E NOME  CODICE FISCALE',
        'ROSSI MARIO  RSSMRA80A01H501U',
        'TOTALE COMPETENZE  TOTALE TRATTENUTE  NETTO IN BUSTA',
        '2.000,00  500,00  1.500,00',
        'JOB - Copyright Sistemi S.p.A.',
      ].join('\n'),
    },
    filename: 'scan_0042.pdf',
    title: 'scan_0042',
    description: null,
  };
  const known: CategoryDefinition[] = [
    'EXPENSE',
    'INCOME',
    'PAYSLIP',
    'WORK',
    'BILL',
    'HOME', // a word match only: TRENTO is not about rent
  ].map((id) => ({
    id,
    title: id === 'PAYSLIP' ? 'Payslip' : id,
    description: id,
    dimension: id === 'PAYSLIP' ? 'DOCUMENT_TYPE' : null,
    template: {
      fields:
        id === 'PAYSLIP'
          ? [
              {
                key: 'pay_period',
                label: 'Pay period',
                type: 'period',
                description: '',
                required: true,
              },
            ]
          : [],
    },
  }));

  it('reads the text of a PDF, not only its file name', async () => {
    const { result } = await new FakeParser().classify(payslip, known);
    expect(result.categoryIds).toEqual(['INCOME', 'PAYSLIP', 'WORK']);
    expect(result.analysis.documentType).toBe('payslip');
    expect(result.analysis.issuer).toBe('ESEMPIO LAVORI S.R.L.');
  });

  it('reads the month paid as a period', async () => {
    const plan = buildExtractionPlan(
      known.filter((category) => category.id === 'PAYSLIP'),
      'general.document@1',
    );
    const { result } = await new FakeParser().extract(payslip, plan);
    expect(result.fields.fields['pay_period']).toMatchObject({
      status: 'found',
      value: '2026-03-01/2026-03-31',
    });
  });
});

describe('companyNameIn and monthPeriod', () => {
  it('finds the first company with a legal form, without the column before it', () => {
    expect(companyNameIn('Fattura n. 1\n12  ACQUE VERONESI S.C.A R.L.')).toBe(
      'ACQUE VERONESI S.C.A R.L.',
    );
    expect(companyNameIn('Enel Energia S.p.A. - Viale Regina')).toBe(
      'Enel Energia S.p.A.',
    );
    expect(companyNameIn('no company here, SPAzio libero')).toBeNull();
  });

  it('knows month lengths, in Italian and English', () => {
    expect(monthPeriod('FEBBRAIO 2028')).toBe('2028-02-01/2028-02-29');
    expect(monthPeriod('Statement for November 2026')).toBe(
      '2026-11-01/2026-11-30',
    );
    expect(monthPeriod('2026')).toBeNull();
  });
});
