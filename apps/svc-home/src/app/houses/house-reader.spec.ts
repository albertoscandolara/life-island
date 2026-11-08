import type { PropertyDto } from '@life-island/contracts';
import { defaultMatchTerms } from '../properties/properties.service.js';
import {
  mergeReadings,
  parseAddress,
  proposeHouseChanges,
  readHouse,
  tidyName,
} from './house-reader.js';

const parentOf = new Map<string, string | null>([
  ['BILL', null],
  ['ELECTRICITY_BILL', 'BILL'],
  ['GAS_BILL', 'BILL'],
]);

const bandi = {
  id: 'p2',
  matchTerms: ['dei bandi'],
  supplyCodes: ['IT001E36435004'],
  categoryIds: [],
};

function house(overrides: Partial<PropertyDto> = {}): PropertyDto {
  return {
    id: 'p2',
    name: 'Via dei Bandi',
    type: 'HOUSE',
    tenure: 'OWNED',
    isResidence: false,
    address: null,
    postalCode: null,
    city: null,
    province: null,
    country: null,
    areaSqm: null,
    rooms: null,
    yearBuilt: null,
    cadastralSheet: null,
    cadastralParcel: null,
    cadastralSubunit: null,
    cadastralCategory: null,
    cadastralIncome: null,
    purchaseDate: null,
    purchasePrice: null,
    owners: [],
    electricitySupplier: null,
    gasSupplier: null,
    waterSupplier: null,
    condoManager: null,
    insurer: null,
    colorSlot: 1,
    matchTerms: ['dei bandi'],
    supplyCodes: ['IT001E36435004'],
    categoryIds: [],
    notes: null,
    model: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

const doc = (
  fields: Record<string, string | number | null>,
  categories: string[] = [],
) => ({
  uploadId: crypto.randomUUID(),
  title: 'Document',
  categories,
  fields,
  uploadedAt: '2026-10-01T10:00:00.000Z',
});

describe('parseAddress', () => {
  it('splits street, postal code, city and province', () => {
    expect(parseAddress('Via dei Bandi 10, 37039 Tregnago (VR)')).toEqual({
      street: 'Via dei Bandi 10',
      postalCode: '37039',
      city: 'Tregnago',
      province: 'VR',
    });
    expect(parseAddress("VIA PONZILOVO 9 - 37055 RONCO ALL'ADIGE VR")).toEqual({
      street: 'Via Ponzilovo 9',
      postalCode: '37055',
      city: "Ronco all'Adige",
      province: 'VR',
    });
    expect(parseAddress('Via Roma, 5, Verona')?.street).toBe('Via Roma 5');
  });

  it('is null for a town alone', () => {
    expect(parseAddress('Verona')).toBeNull();
  });

  it('tidies upper case names only', () => {
    expect(tidyName('VIA DEI BANDI')).toBe('Via dei Bandi');
    expect(tidyName('Via del Corso')).toBe('Via del Corso');
  });
});

describe('readHouse', () => {
  it('reads supply address, code and supplier of a bill and finds its house', () => {
    const reading = readHouse(
      doc(
        {
          provider: 'Lene S.r.l.',
          customer_id: 'IT001E36435004',
          supply_address: 'Via dei Bandi 10, 37039 Tregnago (VR)',
          total_amount: 80,
        },
        ['ELECTRICITY_BILL'],
      ),
      [bandi],
      parentOf,
      null,
    );
    expect(reading).toMatchObject({
      propertyId: 'p2',
      utility: 'ELECTRICITY',
      supplyCodes: ['IT001E36435004'],
      values: {
        address: 'Via dei Bandi 10',
        city: 'Tregnago',
        electricitySupplier: 'Lene S.r.l.',
      },
    });
  });

  it("never takes a customer code as house data: it is the contract's", () => {
    const gas = house({ supplyCodes: ['01680102015791'] });
    const printed: Record<string, string>[] = [
      { customer_id: '1000007483' },
      { customer_code: '1000007483', supply_point_code: 'IT001E36435004' },
    ];
    for (const fields of printed) {
      const reading = readHouse(
        doc(
          {
            provider: 'Lene S.r.l.',
            supply_address: 'Via dei Bandi 10, 37039 Tregnago (VR)',
            total_amount: 80,
            ...fields,
          },
          ['ELECTRICITY_BILL'],
        ),
        [bandi],
        parentOf,
        null,
      );
      expect(reading?.supplyCodes).not.toContain('1000007483');
      const changes = proposeHouseChanges(mergeReadings([reading!]), gas);
      expect(changes.map((c) => c.proposed).join(' ')).not.toContain(
        '1000007483',
      );
    }
  });

  it('reads cadastral data and owners of a survey, with no house matched', () => {
    const reading = readHouse(
      doc({
        property_address: 'Via Roma 5, 37100 Verona (VR)',
        floor_area_sqm: '95',
        cadastral_category: 'A/2',
        cadastral_income: '512,30',
        owner_names: 'ROSSI MARIO; BIANCHI ANNA',
      }),
      [bandi],
      parentOf,
      null,
    );
    expect(reading?.propertyId).toBeNull();
    expect(reading?.values).toMatchObject({
      areaSqm: '95',
      cadastralCategory: 'A/2',
      cadastralIncome: '512.3',
    });
    expect(reading?.owners).toEqual(['Rossi Mario', 'Bianchi Anna']);
  });

  it('says nothing for a document without house data', () => {
    expect(
      readHouse(doc({ total_amount: 5 }), [bandi], parentOf, null),
    ).toBeNull();
  });
});

describe('proposeHouseChanges', () => {
  it('proposes only what is new or different', () => {
    const facts = mergeReadings([
      readHouse(
        doc(
          {
            provider: 'Lene',
            customer_id: 'IT001E36435004',
            supply_address: 'VIA DEI BANDI 10 37039 TREGNAGO VR',
            total_amount: 80,
          },
          ['ELECTRICITY_BILL'],
        ),
        [bandi],
        parentOf,
        null,
      )!,
    ]);
    const changes = proposeHouseChanges(
      facts,
      house({ address: 'via dei bandi, 10', city: 'Verona' }),
    );
    expect(changes.map((c) => [c.field, c.kind])).toEqual([
      ['postalCode', 'new_value'],
      ['city', 'different_value'],
      ['province', 'new_value'],
      ['electricitySupplier', 'new_value'],
    ]);
  });
});

describe('defaultMatchTerms', () => {
  it('drops the street word and the number', () => {
    expect(defaultMatchTerms('Via Ponzilovo 9')).toEqual(['ponzilovo']);
    expect(defaultMatchTerms('Via dei Bandi')).toEqual(['dei bandi']);
  });
});
