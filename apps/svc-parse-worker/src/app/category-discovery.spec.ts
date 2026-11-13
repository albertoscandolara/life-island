import type { DocumentAnalysis } from '@life-island/contracts';
import {
  cleanTemplate,
  filterSuggestions,
  issuerName,
  normalizeCategoryId,
  withIssuerFallback,
} from './category-discovery.js';
import type { ProposedCategory } from './parsers/document-parser.js';

const proposal = (id: string, title = id): ProposedCategory => ({
  id,
  title,
  description: `${title} documents`,
  reason: 'seen in the document',
  template: {
    fields: [
      {
        key: 'total_amount',
        label: 'Total',
        type: 'amount',
        description: '',
        required: true,
      },
    ],
  },
});

const existing = ['BILL', 'WATER_BILL', 'EXPENSE', 'ACQUE_VERONESI'].map(
  (id) => ({
    id,
    title: id.charAt(0) + id.slice(1).toLowerCase().replace(/_/g, ' '),
    description: '',
    template: { fields: [] },
  }),
);

describe('normalizeCategoryId', () => {
  it.each([
    ['Electricity bill', 'ELECTRICITY_BILL'],
    ['acque-veronesi', 'ACQUE_VERONESI'],
    ['  Città  ', 'CITTA'],
    ['1', null],
    ['__', null],
  ])('%s → %s', (raw, id) => {
    expect(normalizeCategoryId(raw)).toBe(id);
  });
});

describe('filterSuggestions', () => {
  it('keeps new categories even though existing ones match the document (the ENEL example)', () => {
    const { accepted, dropped } = filterSuggestions(
      [
        proposal('ELECTRICITY_BILL', 'Electricity bill'),
        proposal('ENEL', 'Enel'),
        proposal('BILLS', 'Bills'),
      ],
      { categories: existing, pending: [], rejectedIds: [] },
    );
    expect(accepted.map((item) => item.id)).toEqual([
      'ELECTRICITY_BILL',
      'ENEL',
    ]);
    expect(dropped).toEqual([
      { id: 'BILLS', reason: 'already exists as BILL' },
    ]);
  });

  it('drops duplicates by title and ids you rejected', () => {
    const { accepted, dropped } = filterSuggestions(
      [
        proposal('H2O_BILL', 'Water bill'),
        proposal('UTILITY', 'Utility'),
        proposal('enel', 'Enel'),
        proposal('ENEL'),
      ],
      { categories: existing, pending: [], rejectedIds: ['UTILITIES'] },
    );
    expect(accepted.map((item) => item.id)).toEqual(['ENEL']);
    expect(dropped.map((item) => item.reason)).toEqual([
      'already exists as WATER_BILL',
      'rejected before',
      'proposed twice',
    ]);
  });

  it('joins a pending suggestion instead of creating a near-duplicate', () => {
    const pending = [
      {
        ...proposal('ELECTRICITY_BILL', 'Electricity bill'),
        title: 'Electricity bill',
      },
    ];
    const { accepted } = filterSuggestions(
      [proposal('ELECTRICITY_BILLS', 'Electricity bills')],
      { categories: existing, pending, rejectedIds: [] },
    );
    expect(accepted).toHaveLength(1);
    expect(accepted[0]).toMatchObject({
      id: 'ELECTRICITY_BILL',
      title: 'Electricity bill',
    });
  });
});

describe('placement of a suggestion', () => {
  const tree = [
    {
      id: 'BILL',
      title: 'Bill',
      description: '',
      template: { fields: [] },
      dimension: 'DOCUMENT_TYPE' as const,
    },
    { id: 'HOME', title: 'Home', description: '', template: { fields: [] } },
  ];

  it('goes under an existing parent and takes its dimension', () => {
    const { accepted } = filterSuggestions(
      [
        {
          ...proposal('ELECTRICITY_BILL', 'Electricity bill'),
          parentId: 'BILL',
          dimension: 'SUBJECT',
        },
      ],
      { categories: tree, pending: [], rejectedIds: [] },
    );
    expect(accepted[0]).toMatchObject({
      parentId: 'BILL',
      dimension: 'DOCUMENT_TYPE',
    });
  });

  it('drops a parent that does not exist and keeps a valid dimension', () => {
    const { accepted } = filterSuggestions(
      [
        {
          ...proposal('ACQUE_VERONESI', 'Acque Veronesi'),
          parentId: 'WATER_UTILITY',
          dimension: 'ISSUER',
        },
        {
          ...proposal('TREGNAGO_HOUSE', 'Tregnago house'),
          dimension: 'PLACE' as never,
        },
      ],
      { categories: tree, pending: [], rejectedIds: [] },
    );
    expect(
      accepted.map(({ id, parentId, dimension }) => ({
        id,
        parentId,
        dimension,
      })),
    ).toEqual([
      { id: 'ACQUE_VERONESI', parentId: null, dimension: 'ISSUER' },
      { id: 'TREGNAGO_HOUSE', parentId: null, dimension: null },
    ]);
  });

  it('never proposes the same street twice, or a car as a place', () => {
    const places = [
      {
        id: 'VIA_PONZILOVO_9',
        title: 'Via Ponzilovo 9',
        description: '',
        template: { fields: [] },
        dimension: 'PROPERTY' as const,
      },
    ];
    const { accepted, dropped } = filterSuggestions(
      [
        {
          ...proposal('VIA_PONZILOVO', 'Via Ponzilovo'),
          dimension: 'PROPERTY',
        },
        {
          ...proposal('FIAT_PUNTO_EJ560PZ', 'Fiat Punto EJ560PZ'),
          dimension: 'PROPERTY',
        },
        {
          ...proposal('VIA_DEI_BANDI_10', 'Via dei Bandi, 10'),
          dimension: 'PROPERTY',
        },
      ],
      { categories: places, pending: [], rejectedIds: [] },
    );
    expect(dropped).toEqual([
      { id: 'VIA_PONZILOVO', reason: 'the same place as VIA_PONZILOVO_9' },
    ]);
    expect(accepted.map(({ id, dimension }) => [id, dimension])).toEqual([
      ['FIAT_PUNTO_EJ560PZ', 'SUBJECT'],
      ['VIA_DEI_BANDI_10', 'PROPERTY'],
    ]);
  });
});

describe('issuerName', () => {
  it.each([
    ['Acque Veronesi S.c.a r.l.', 'Acque Veronesi'],
    ['ENEL ENERGIA S.p.A.', 'ENEL ENERGIA'],
    ['Lena Srl', 'Lena'],
    ['Farmacia Rossi, S.n.c.', 'Farmacia Rossi'],
    ['Amazon EU S.à r.l.', 'Amazon EU'],
    ['Comune di Verona', 'Comune di Verona'],
    ['SPA', 'SPA'],
  ])('%s → %s', (printed, name) => {
    expect(issuerName(printed)).toBe(name);
  });
});

describe('withIssuerFallback (the ACQUE_VERONESI case)', () => {
  const categories = [
    {
      id: 'BILL',
      title: 'Bill',
      description: '',
      template: { fields: [] },
      dimension: 'DOCUMENT_TYPE' as const,
    },
    {
      id: 'WATER_BILL',
      title: 'Water bill',
      description: '',
      template: { fields: [] },
      dimension: 'DOCUMENT_TYPE' as const,
      parentId: 'BILL',
    },
    {
      id: 'LENA',
      title: 'Lena',
      description: '',
      template: { fields: [] },
      dimension: 'ISSUER' as const,
    },
  ];
  const analysis = (issuer: string | null) =>
    ({
      documentType: 'water bill',
      purpose: '',
      characteristics: [],
      issuer,
    }) as unknown as DocumentAnalysis;

  it('proposes the issuer the model left out', () => {
    const result = withIssuerFallback(
      [proposal('WATER_SUPPLY', 'Water supply')],
      {
        categories,
        analysis: analysis('Acque Veronesi S.c.a r.l.'),
        assignedIds: ['BILL', 'WATER_BILL'],
      },
    );
    expect(result.map((item) => item.id)).toEqual([
      'WATER_SUPPLY',
      'ACQUE_VERONESI',
    ]);
    expect(result[1]).toMatchObject({
      title: 'Acque Veronesi',
      dimension: 'ISSUER',
      parentId: null,
    });
    const { accepted } = filterSuggestions(result, {
      categories,
      pending: [],
      rejectedIds: [],
    });
    expect(accepted.map((item) => item.id)).toContain('ACQUE_VERONESI');
  });

  it('adds nothing when the issuer is already assigned, proposed, or not shown', () => {
    const base = [proposal('WATER_SUPPLY')];
    expect(
      withIssuerFallback(base, {
        categories,
        analysis: analysis('Lena S.r.l.'),
        assignedIds: ['LENA'],
      }),
    ).toBe(base);
    const proposed = [
      { ...proposal('ACQUE_VERONESI'), dimension: 'ISSUER' as const },
    ];
    expect(
      withIssuerFallback(proposed, {
        categories,
        analysis: analysis('Acque Veronesi'),
        assignedIds: [],
      }),
    ).toBe(proposed);
    expect(
      withIssuerFallback(base, {
        categories,
        analysis: analysis(null),
        assignedIds: [],
      }),
    ).toBe(base);
  });

  it('is dropped by the filter when that issuer exists or was rejected', () => {
    const existingIssuer = withIssuerFallback([], {
      categories,
      analysis: analysis('LENA SRL'),
      assignedIds: [],
    });
    expect(
      filterSuggestions(existingIssuer, {
        categories,
        pending: [],
        rejectedIds: [],
      }).accepted,
    ).toEqual([]);
    const rejected = withIssuerFallback([], {
      categories,
      analysis: analysis('Acque Veronesi'),
      assignedIds: [],
    });
    expect(
      filterSuggestions(rejected, {
        categories,
        pending: [],
        rejectedIds: ['ACQUE_VERONESI'],
      }).accepted,
    ).toEqual([]);
  });
});

describe('cleanTemplate', () => {
  it('keeps valid fields only, once per key', () => {
    expect(
      cleanTemplate({
        fields: [
          { key: 'total_amount', label: 'Total', type: 'amount' },
          { key: 'total_amount', label: 'Again', type: 'amount' },
          { key: 'Bad Key', label: 'x', type: 'string' },
          { key: 'kind', label: 'Kind', type: 'enum' },
        ],
      }),
    ).toEqual({
      fields: [
        {
          key: 'total_amount',
          label: 'Total',
          type: 'amount',
          description: '',
          required: false,
        },
      ],
    });
  });
});
