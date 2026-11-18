import {
  billingPeriod,
  matchProperty,
  readBill,
  readBillFacts,
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
  ['INTERNET_BILL', 'BILL'],
  ['TELECOM_BILL', 'BILL'],
  ['MOBILE_PHONE_BILL', 'BILL'],
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

  it('trusts the supply address over a category read from the mailing address', () => {
    // The gas bill of the house in Via dei Bandi, mailed to Via Ponzilovo.
    expect(
      matchProperty(
        doc({
          categories: ['GAS_BILL', 'PONZILOVO'],
          fields: {
            customer_address: 'Via Ponzilovo 3, Verona',
            supply_address: 'Via dei Bandi 4, Tregnago',
          },
        }),
        props,
        parentOf,
        null,
      ),
    ).toEqual({ propertyId: 'p2', assignment: 'ADDRESS' });
  });

  it('never assigns a bill by the address it is mailed to', () => {
    expect(
      matchProperty(
        doc({
          fields: {
            billing_address: 'Via Ponzilovo 3, Verona',
            indirizzo_cliente: 'Via Ponzilovo 3',
          },
        }),
        props,
        parentOf,
        null,
      ),
    ).toEqual({ propertyId: null, assignment: null });
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
      fee: null,
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

describe('internet bills', () => {
  /** A monthly internet bill, as the template reads it (made-up figures). */
  const internet = (fields: DocumentLike['fields'] = {}): DocumentLike => ({
    uploadId: 'net1',
    title: 'Conto telefonico',
    categories: ['BILL', 'INTERNET_BILL'],
    fields: {
      provider: 'Fibra Esempio S.p.A.',
      supplier_tax_code: 'IT 01234567890',
      invoice_number: 'F2600000001',
      customer_code: 'P0000000001',
      line_number: '045 1234567',
      migration_code: 'ABC01234567890123 X',
      offer_name: 'Internet 200',
      offer_start_date: '2020-06-18',
      billing_period: '2025-12-01/2025-12-31',
      subscription_period: '2026-01-01/2026-01-31',
      issue_date: '2026-01-12',
      due_date: '2026-02-11',
      subscription_fee: '30,98',
      total_amount: '30,98',
      payment_method: 'Domiciliazione bancaria',
      ...fields,
    },
  });

  it('is a fourth utility, by its category or by what only it prints', () => {
    expect(utilityOf(['INTERNET_BILL'], null, parentOf)).toBe('INTERNET');
    expect(utilityOf(['BILL', 'TELECOM_BILL'], null, parentOf)).toBe(
      'INTERNET',
    );
    expect(
      utilityOf(['BILL'], { migration_code: 'ABC0123456789' }, parentOf),
    ).toBe('INTERNET');
    // A mobile phone bill is not a home line.
    expect(utilityOf(['MOBILE_PHONE_BILL'], null, parentOf)).toBeNull();
  });

  it('counts in the month its fee pays for, with no consumption', () => {
    const bill = readBill(internet(), [], parentOf, null);
    expect(bill).toMatchObject({
      utility: 'INTERNET',
      periodStart: '2026-01-01',
      periodEnd: '2026-01-31',
      dueDate: '2026-02-11',
      amount: 30.98,
      fee: 30.98,
      consumption: null,
      unit: '',
    });
  });

  it('is on its line: the number, else the migration code', () => {
    const facts = readBillFacts(internet().fields ?? {}, 'INTERNET');
    expect(facts).toMatchObject({
      supplyPointCode: '0451234567',
      customerCode: 'P0000000001',
      supplierTaxCode: '01234567890',
      offerName: 'Internet 200',
      offerStart: '2020-06-18',
      directDebit: true,
    });
    expect(
      readBillFacts(internet({ line_number: null }).fields ?? {}, 'INTERNET')
        .supplyPointCode,
    ).toBe('ABC01234567890123X');
  });

  it('finds its house by its line, once the line is the house’s', () => {
    const house: PropertyLike = {
      id: 'p3',
      matchTerms: [],
      supplyCodes: ['0451234567'],
      categoryIds: [],
    };
    expect(readBill(internet(), [house], parentOf, null)).toMatchObject({
      propertyId: 'p3',
      assignment: 'SUPPLY_CODE',
    });
  });
});
