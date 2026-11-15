import type { DossierExpenseDto } from '@life-island/contracts';
import {
  isHouseExpense,
  placeTaxExpense,
  type PlaceContext,
} from './house-tax-expenses.js';

const houses = [
  {
    id: 'p1',
    address: 'Via Ponzilovo 9',
    matchTerms: ['ponzilovo'],
    supplyCodes: [],
    categoryIds: [],
  },
  {
    id: 'p2',
    address: 'Via dei Bandi 10',
    matchTerms: ['dei bandi'],
    supplyCodes: [],
    categoryIds: [],
  },
];

function expense(
  overrides: Partial<DossierExpenseDto> = {},
): DossierExpenseDto {
  return {
    id: 'e1',
    sourceStagingId: 's1',
    uploadId: 'u-invoice',
    taxYear: 2025,
    expenseType: 'renovation',
    frame730: 'E41',
    date: '2025-06-10',
    amount: 4800,
    beneficiaryFiscalCode: null,
    traceablePayment: true,
    issuer: 'Edilrenso SNC',
    documentNumber: '12/2025',
    description: 'Rifacimento bagno',
    notes: null,
    attachments: [
      { uploadId: 'u-invoice', role: 'INVOICE', document: null },
      { uploadId: 'u-transfer', role: 'PAYMENT', document: null },
    ],
    hasInvoice: true,
    hasPaymentProof: true,
    kind: 'INVOICE',
    pairing: null,
    paired: [
      {
        id: 'e2',
        date: '2025-06-12',
        amount: 4800,
        issuer: 'Edilrenso SNC',
        description: null,
        kind: 'PAYMENT',
        automatic: false,
      },
    ],
    ...overrides,
  };
}

function context(overrides: Partial<PlaceContext> = {}): PlaceContext {
  return {
    properties: houses,
    parentOf: new Map(),
    documents: new Map([
      [
        'u-invoice',
        {
          uploadId: 'u-invoice',
          title: 'Fattura Edilrenso',
          categories: [],
          fields: {
            issuer_address: 'Via Ponzilovo 1, Ronco',
            property_address: 'Via dei Bandi 10, 37039 Tregnago (VR)',
          },
        },
      ],
    ]),
    works: new Map([['w1', { propertyId: 'p1' }]]),
    workOfUpload: new Map(),
    links: new Map(),
    ...overrides,
  };
}

describe('placeTaxExpense', () => {
  it('keeps only home expenses', () => {
    expect(isHouseExpense({ expenseType: 'renovation' })).toBe(true);
    expect(isHouseExpense({ expenseType: 'medical' })).toBe(false);
  });

  it("finds the house its invoice names, never the firm's own address", () => {
    const placed = placeTaxExpense(expense(), context());
    expect(placed).toMatchObject({
      propertyId: 'p2',
      match: 'DOCUMENT',
      workId: null,
    });
    expect(placed.documents.map((d) => [d.uploadId, d.role, d.title])).toEqual([
      ['u-invoice', 'INVOICE', 'Fattura Edilrenso'],
      ['u-transfer', 'PAYMENT', null],
    ]);
  });

  it('follows the work its payment is filed under', () => {
    const placed = placeTaxExpense(
      expense(),
      context({ workOfUpload: new Map([['u-transfer', 'w1']]) }),
    );
    expect(placed).toMatchObject({
      propertyId: 'p1',
      match: 'WORK',
      workId: 'w1',
    });
  });

  it('follows your choice, kept on any expense of the pair', () => {
    const placed = placeTaxExpense(
      expense(),
      context({
        links: new Map([
          [
            'e2',
            {
              expenseId: 'e2',
              manualProperty: true,
              propertyId: 'p1',
              workId: null,
            },
          ],
        ]),
      }),
    );
    expect(placed).toMatchObject({ propertyId: 'p1', match: 'MANUAL' });
  });

  it('puts it on your only house when nothing else tells', () => {
    const placed = placeTaxExpense(
      expense({ uploadId: 'u-other', attachments: [] }),
      context({ properties: [houses[0]] }),
    );
    expect(placed).toMatchObject({ propertyId: 'p1', match: 'ONLY_HOUSE' });
  });
});
