import {
  groupFields,
  homeFromSupplyAddress,
  summarize,
  type CategoryInfo,
  type ReviewField,
} from './review-summary';

const field = (
  key: string,
  overrides: Partial<ReviewField> = {},
): ReviewField => ({
  key,
  label: key,
  type: 'string',
  value: null,
  status: 'missing',
  required: false,
  categories: [],
  ...overrides,
});

const tree: Record<string, CategoryInfo> = {
  BILL: { title: 'Bill', parentId: null, dimension: 'DOCUMENT_TYPE' },
  ELECTRICITY_BILL: {
    title: 'Electricity bill',
    parentId: 'BILL',
    dimension: 'DOCUMENT_TYPE',
  },
  LENA: { title: 'Lena', parentId: null, dimension: 'ISSUER' },
  VIA_DEI_BANDI: {
    title: 'Via dei Bandi',
    parentId: null,
    dimension: 'PROPERTY',
  },
  RECEIPT: { title: 'Receipt', parentId: null, dimension: 'DOCUMENT_TYPE' },
};
const lookup = (id: string) => tree[id];

describe('groupFields', () => {
  it('puts what to check first, then what was read, and folds the empty ones', () => {
    const fields = [
      field('electricity_consumption', { value: 120, status: 'found' }),
      field('total_amount', {
        status: 'conflicting',
        candidates: ['50.12', '7.20'],
      }),
      field('provider', { value: 'Lena', status: 'found' }),
      field('due_date'),
      field('customer_id', { required: true }),
    ];
    const groups = groupFields(fields, {
      electricity_consumption: '120',
      provider: 'Lena',
      total_amount: '',
      due_date: '',
      customer_id: '',
    });
    expect(groups.doubtful.map((f) => f.key)).toEqual([
      'total_amount',
      'customer_id',
    ]);
    // The common record first: provider stands in for the issuer.
    expect(groups.found.map((f) => f.key)).toEqual([
      'provider',
      'electricity_consumption',
    ]);
    expect(groups.empty.map((f) => f.key)).toEqual(['due_date']);
  });

  it('moves a required field out of the doubts once you fill it', () => {
    const groups = groupFields([field('customer_id', { required: true })], {
      customer_id: 'IT001E1',
    });
    expect(groups.doubtful).toEqual([]);
    expect(groups.found.map((f) => f.key)).toEqual(['customer_id']);
  });
});

describe('summarize', () => {
  it('says what a bill is, how much, and that it goes to Bills for its home', () => {
    expect(
      summarize(
        ['ELECTRICITY_BILL', 'LENA', 'VIA_DEI_BANDI'],
        {
          provider: 'Lena Energia',
          total_amount: '50.12',
          currency: 'EUR',
          issue_date: '2026-10-02',
        },
        'other',
        lookup,
      ),
    ).toEqual({
      type: 'Electricity bill',
      issuer: 'Lena Energia',
      amount: 50.12,
      currency: 'EUR',
      date: '2026-10-02',
      properties: ['Via dei Bandi'],
      destinations: ['Bills'],
    });
  });

  it('names the module for a receipt and the archive for anything else', () => {
    expect(
      summarize(['RECEIPT'], {}, 'groceries', lookup).destinations,
    ).toEqual(['Groceries']);
    const other = summarize(['LENA'], {}, 'other', lookup);
    expect(other.destinations).toEqual(['Documents only']);
    expect(other.issuer).toBe('Lena');
    expect(other.amount).toBeNull();
  });
});

describe('homeFromSupplyAddress', () => {
  const homes = [
    { id: 'VIA_PONZILOVO', title: 'Via Ponzilovo' },
    { id: 'VIA_DEI_BANDI', title: 'Via dei Bandi' },
  ];

  it('finds the home a supply address names, whatever its case and accents', () => {
    expect(
      homeFromSupplyAddress(
        {
          supply_address: 'VIA DEI BÀNDI 4, Tregnago',
          customer_address: 'Via Ponzilovo 3',
        },
        homes,
      )?.id,
    ).toBe('VIA_DEI_BANDI');
  });

  it('does not guess without a supply address or between two homes', () => {
    expect(
      homeFromSupplyAddress({ customer_address: 'Via Ponzilovo 3' }, homes),
    ).toBeNull();
    expect(
      homeFromSupplyAddress(
        { supply_address: 'Ponzilovo, angolo dei Bandi' },
        homes,
      ),
    ).toBeNull();
  });
});
