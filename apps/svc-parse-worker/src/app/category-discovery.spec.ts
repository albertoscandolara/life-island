import {
  cleanTemplate,
  filterSuggestions,
  normalizeCategoryId,
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
