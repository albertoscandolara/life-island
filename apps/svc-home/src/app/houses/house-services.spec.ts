import {
  houseServices,
  readService,
  serviceKindOf,
  type CategoryInfo,
} from './house-services.js';

const categories: CategoryInfo = new Map([
  ['BILL', { title: 'Bill', parentId: null }],
  ['ELECTRICITY_BILL', { title: 'Electricity bill', parentId: 'BILL' }],
  ['TELCO_BILL', { title: 'Bolletta internet', parentId: 'BILL' }],
  ['FIBRA_CONTRACT', { title: 'Contratto fibra', parentId: null }],
  ['INSURANCE', { title: 'Insurance', parentId: null }],
  ['HOME_INSURANCE', { title: 'Assicurazione casa', parentId: 'INSURANCE' }],
  ['CAR_INSURANCE', { title: 'Car insurance', parentId: 'INSURANCE' }],
]);

const bandi = {
  id: 'p2',
  address: 'Via dei Bandi 10',
  matchTerms: ['dei bandi'],
  supplyCodes: [],
  categoryIds: [],
};

const doc = (
  categoriesOf: string[],
  fields: Record<string, string | number>,
) => ({
  uploadId: crypto.randomUUID(),
  title: 'Document',
  categories: categoriesOf,
  fields,
  uploadedAt: '2026-10-01T10:00:00.000Z',
});

describe('serviceKindOf', () => {
  it('reads your categories by their words', () => {
    expect(serviceKindOf(doc(['TELCO_BILL'], {}), categories)?.kind).toBe(
      'INTERNET',
    );
    expect(serviceKindOf(doc(['FIBRA_CONTRACT'], {}), categories)?.kind).toBe(
      'INTERNET',
    );
    expect(serviceKindOf(doc(['HOME_INSURANCE'], {}), categories)).toEqual({
      kind: 'INSURANCE',
      sure: true,
    });
  });

  it('leaves out car insurances and utility bills', () => {
    expect(serviceKindOf(doc(['CAR_INSURANCE'], {}), categories)).toBeNull();
    expect(serviceKindOf(doc(['ELECTRICITY_BILL'], {}), categories)).toBeNull();
  });
});

describe('houseServices', () => {
  const today = '2026-11-15';

  it('makes one internet line per house and provider, the last billed one active', () => {
    const readings = [
      doc(['FIBRA_CONTRACT'], {
        provider: 'TIM S.p.A.',
        offer_name: 'TIM Premium Fibra',
        monthly_fee: 29.9,
        line_number: '045 1234567',
        installation_address: 'Via dei Bandi 10, 37039 Tregnago (VR)',
        start_date: '2025-02-01',
      }),
      doc(['TELCO_BILL'], {
        provider: 'TIM',
        billing_period: '2025-09-01/2025-10-31',
        total_amount: 59.8,
        supply_address: 'Via dei Bandi 10, Tregnago',
      }),
      doc(['TELCO_BILL'], {
        provider: 'Iliad',
        billing_period: '2026-09-01/2026-09-30',
        total_amount: 19.99,
        supply_address: 'Via dei Bandi 10, Tregnago',
      }),
    ].map((d) => readService(d, categories, [bandi], null)!);
    expect(readings.every((r) => r.propertyId === 'p2')).toBe(true);
    const { internet } = houseServices(readings, today);
    expect(internet.map((l) => [l.provider, l.status])).toEqual([
      ['Iliad', 'ACTIVE'],
      ['TIM', 'ENDED'],
    ]);
    const tim = internet[1];
    expect(tim).toMatchObject({
      offerName: 'TIM Premium Fibra',
      monthlyCost: 29.9,
      lineNumber: '045 1234567',
      lastBill: { date: '2025-10-31', amount: 59.8 },
      yearCost: 0,
    });
    expect(internet[0].yearCost).toBe(19.99);
    expect(internet[0].monthlyCost).toBeCloseTo(20.3, 1);
  });

  it('tells an active insurance from an expired one', () => {
    const readings = [
      doc(['HOME_INSURANCE'], {
        insurer: 'Allianz',
        policy_number: 'AB-123',
        coverage: 'Incendio e furto',
        start_date: '2026-03-01',
        end_date: '2027-02-28',
        annual_premium: 240,
        insured_address: 'Via dei Bandi 10, Tregnago',
      }),
      doc(['HOME_INSURANCE'], {
        insurer: 'Generali',
        policy_number: '998',
        start_date: '2024-03-01',
        end_date: '2025-02-28',
      }),
    ].map((d) => readService(d, categories, [bandi], null)!);
    const { insurances } = houseServices(readings, today);
    expect(insurances.map((i) => [i.insurer, i.status, i.propertyId])).toEqual([
      ['Allianz', 'ACTIVE', 'p2'],
      ['Generali', 'EXPIRED', null],
    ]);
    expect(insurances[0]).toMatchObject({
      coverage: 'Incendio e furto',
      premium: 240,
    });
  });

  it('takes a generic insurance only when it names one of your houses', () => {
    const generic = (address: string) =>
      readService(
        doc(['INSURANCE'], { insurer: 'Unipol', property_address: address }),
        categories,
        [bandi],
        null,
      );
    expect(generic('Via dei Bandi 10, Tregnago')?.propertyId).toBe('p2');
    expect(generic('Corso Milano 3, Verona')).toBeNull();
  });

  it('follows your choice of house, and leaves out what you excluded', () => {
    const document = doc(['TELCO_BILL'], { provider: 'Fastweb' });
    const override = {
      manualProperty: true,
      propertyId: 'p9',
      utility: null,
      excluded: false,
    };
    expect(
      readService(document, categories, [bandi], override)?.propertyId,
    ).toBe('p9');
    expect(
      readService(document, categories, [bandi], {
        ...override,
        excluded: true,
      }),
    ).toBeNull();
  });
});
