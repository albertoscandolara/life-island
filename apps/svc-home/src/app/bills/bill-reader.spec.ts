import {
  billingPeriod,
  matchProperty,
  readBill,
  toNumber,
  utilityOf,
  type DocumentLike,
  type PropertyLike,
} from './bill-reader.js';

const parentOf = new Map<string, string | null>([
  ['BILL', null],
  ['ELECTRICITY_BILL', 'BILL'],
  ['GAS_BILL', 'BILL'],
  ['WATER_BILL', 'BILL'],
  ['ENEL_BILL', 'ELECTRICITY_BILL'],
  ['PROPERTY', null],
  ['PONZILOVO', 'PROPERTY'],
]);

const ponzilovo: PropertyLike = {
  id: 'p1',
  matchTerms: ['Ponzilovo'],
  supplyCodes: ['IT001E12345678'],
  categoryIds: ['PONZILOVO'],
};
const bandi: PropertyLike = {
  id: 'p2',
  matchTerms: ['dei Bandi'],
  supplyCodes: ['PDR 0099887766'],
  categoryIds: [],
};

const doc = (overrides: Partial<DocumentLike> = {}): DocumentLike => ({
  uploadId: 'u1',
  title: 'Gas bill',
  categories: ['BILL', 'GAS_BILL'],
  fields: {
    provider: 'Hera',
    billing_period: '2026-01-01/2026-02-28',
    issue_date: '2026-03-05',
    due_date: '2026-03-25',
    gas_consumption: 210,
    total_amount: 180.4,
  },
  ...overrides,
});

describe('utilityOf', () => {
  it('reads the utility from a category or one of its ancestors', () => {
    expect(utilityOf(['WATER_BILL'], null, parentOf)).toBe('WATER');
    expect(utilityOf(['ENEL_BILL'], null, parentOf)).toBe('ELECTRICITY');
  });

  it('falls back to the consumption field of a plain bill', () => {
    expect(
      utilityOf(['BILL'], { electricity_consumption: 300 }, parentOf),
    ).toBe('ELECTRICITY');
    expect(utilityOf(['BILL'], { total_amount: 3 }, parentOf)).toBeNull();
    expect(utilityOf(['INVOICE'], { gas_consumption: 3 }, parentOf)).toBeNull();
  });
});

describe('field parsing', () => {
  it('parses amounts written the Italian way', () => {
    expect(toNumber('1.234,56')).toBe(1234.56);
    expect(toNumber('€ 80,5')).toBe(80.5);
    expect(toNumber('1,234')).toBe(1234);
    expect(toNumber('n/a')).toBeNull();
  });

  it('reads a billing period in either order', () => {
    expect(billingPeriod({ billing_period: '2026-02-28/2026-01-01' })).toEqual({
      start: '2026-01-01',
      end: '2026-02-28',
    });
    expect(
      billingPeriod({ period_start: '2026-01-01', period_end: '2026-01-31' }),
    ).toEqual({ start: '2026-01-01', end: '2026-01-31' });
    expect(billingPeriod({ billing_period: 'Jan 2026' })).toBeNull();
  });
});

describe('matchProperty', () => {
  const props = [ponzilovo, bandi];

  it('prefers a category of the property', () => {
    expect(
      matchProperty(
        doc({ categories: ['GAS_BILL', 'PONZILOVO'] }),
        props,
        parentOf,
        null,
      ),
    ).toEqual({ propertyId: 'p1', assignment: 'CATEGORY' });
  });

  it('matches a supply code whatever its spacing', () => {
    expect(
      matchProperty(
        doc({ fields: { customer_id: 'pdr-0099 8877 66' } }),
        props,
        parentOf,
        null,
      ),
    ).toEqual({ propertyId: 'p2', assignment: 'SUPPLY_CODE' });
  });

  it('matches a whole term in an address, ignoring accents and case', () => {
    expect(
      matchProperty(
        doc({ fields: { supply_address: 'VIA DEI BÀNDI 4, Verona' } }),
        props,
        parentOf,
        null,
      ),
    ).toEqual({ propertyId: 'p2', assignment: 'ADDRESS' });
    // "bandito" is not "dei bandi"
    expect(
      matchProperty(
        doc({ fields: { supply_address: 'Via dei Banditi 2' } }),
        props,
        parentOf,
        null,
      ).propertyId,
    ).toBeNull();
  });

  it('leaves a bill unassigned when two properties match equally', () => {
    expect(
      matchProperty(
        doc({ title: 'Ponzilovo and dei Bandi' }),
        props,
        parentOf,
        null,
      ),
    ).toEqual({ propertyId: null, assignment: null });
  });

  it('keeps your manual choice, even "no property"', () => {
    const categorized = doc({ categories: ['GAS_BILL', 'PONZILOVO'] });
    expect(
      matchProperty(categorized, props, parentOf, {
        manualProperty: true,
        propertyId: 'p2',
        utility: null,
        excluded: false,
      }),
    ).toEqual({ propertyId: 'p2', assignment: 'MANUAL' });
    expect(
      matchProperty(categorized, props, parentOf, {
        manualProperty: true,
        propertyId: null,
        utility: null,
        excluded: false,
      }),
    ).toEqual({ propertyId: null, assignment: null });
  });
});

describe('readBill', () => {
  it('reads everything Bills shows', () => {
    expect(
      readBill(
        doc({ fields: { ...doc().fields, supply_address: 'Via Ponzilovo 1' } }),
        [ponzilovo, bandi],
        parentOf,
        null,
      ),
    ).toEqual({
      uploadId: 'u1',
      title: 'Gas bill',
      utility: 'GAS',
      utilityOverridden: false,
      propertyId: 'p1',
      assignment: 'ADDRESS',
      provider: 'Hera',
      customerId: null,
      periodStart: '2026-01-01',
      periodEnd: '2026-02-28',
      issueDate: '2026-03-05',
      dueDate: '2026-03-25',
      amount: 180.4,
      currency: 'EUR',
      consumption: 210,
      unit: 'Smc',
    });
  });

  it('skips documents that are not utility bills, excluded or without an amount', () => {
    expect(
      readBill(doc({ categories: ['INVOICE'] }), [], parentOf, null),
    ).toBeNull();
    expect(
      readBill(doc({ fields: { provider: 'Hera' } }), [], parentOf, null),
    ).toBeNull();
    expect(
      readBill(doc(), [], parentOf, {
        manualProperty: false,
        propertyId: null,
        utility: null,
        excluded: true,
      }),
    ).toBeNull();
  });

  it('applies your utility correction', () => {
    const bill = readBill(doc(), [], parentOf, {
      manualProperty: false,
      propertyId: null,
      utility: 'WATER',
      excluded: false,
    });
    expect(bill?.utility).toBe('WATER');
    expect(bill?.utilityOverridden).toBe(true);
    expect(bill?.unit).toBe('m³');
  });
});
