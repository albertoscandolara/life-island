import { addressMatch, namesVehicle } from '@life-island/contracts';
import {
  categoryIdFor,
  findPropertyCategory,
  planPropertyTidy,
  propertyCategoryRequest,
  type CategoryLike,
} from './property-categories.js';

const ponzilovo = { name: 'Via Ponzilovo', matchTerms: ['ponzilovo'] };
const bandi = { name: 'Via dei Bandi', matchTerms: ['dei bandi'] };

describe('property categories', () => {
  it('turns a home name into a category id', () => {
    expect(categoryIdFor('Via dei Bàndi')).toBe('VIA_DEI_BANDI');
    expect(categoryIdFor('3 Rose')).toBe('HOME_3_ROSE');
  });

  it('reuses the PROPERTY category that names the home', () => {
    const categories = [
      {
        id: 'VIA_PONZILOVO',
        title: 'Via Ponzilovo',
        dimension: 'PROPERTY' as const,
      },
      { id: 'PONZILOVO_NEWS', title: 'Ponzilovo news', dimension: null },
      {
        id: 'TREGNAGO_HOUSE',
        title: 'Casa Tregnago',
        dimension: 'PROPERTY' as const,
      },
    ];
    expect(findPropertyCategory(ponzilovo, categories)?.id).toBe(
      'VIA_PONZILOVO',
    );
    expect(findPropertyCategory(bandi, categories)).toBeNull();
    expect(
      findPropertyCategory(
        { name: 'Casa Tregnago', matchTerms: ['tregnago'] },
        categories,
      )?.id,
    ).toBe('TREGNAGO_HOUSE');
  });

  it('does not guess between two categories that both name the home', () => {
    expect(
      findPropertyCategory(ponzilovo, [
        { id: 'VIA_PONZILOVO', title: 'Via Ponzilovo', dimension: 'PROPERTY' },
        { id: 'PONZILOVO_GARAGE', title: 'Garage', dimension: 'PROPERTY' },
      ]),
    ).toBeNull();
  });

  it('describes the home so the AI assigns it by the supply address', () => {
    const request = propertyCategoryRequest(
      { ...bandi, address: 'Via dei Bandi 4', city: 'Tregnago' },
      'VIA_DEI_BANDI',
    );
    expect(request).toMatchObject({
      id: 'VIA_DEI_BANDI',
      // Named by its address, as the review inbox shows it.
      title: 'Via dei Bandi 4',
      dimension: 'PROPERTY',
    });
    expect(request.description).toContain('Via dei Bandi 4, Tregnago');
    expect(request.description).toContain(
      'never by the address a bill is mailed to',
    );
  });

  it('tells a full address from its street, and a car from a place', () => {
    expect(addressMatch('Via Ponzilovo 9', 'Via Ponzilovo, 9')).toBe('full');
    expect(addressMatch('Via Ponzilovo', 'Via Ponzilovo, 9')).toBe('street');
    expect(addressMatch('Via Ponzilovo 11', 'Via Ponzilovo, 9')).toBeNull();
    expect(addressMatch('Via dei Bandi, 10', 'Via Ponzilovo, 9')).toBeNull();
    expect(
      namesVehicle({ id: 'FIAT_PUNTO_EJ560PZ', title: 'Fiat Punto EJ560PZ' }),
    ).toBe(true);
    expect(
      namesVehicle({ id: 'VIA_PONZILOVO_9', title: 'Via Ponzilovo 9' }),
    ).toBe(false);
  });

  it('leaves one category per home, named by its address, and no cars', () => {
    const property = (id: string, title: string): CategoryLike => ({
      id,
      title,
      dimension: 'PROPERTY',
      parentId: null,
    });
    const categories = [
      property('VIA_PONZILOVO', 'Via Ponzilovo'),
      property('VIA_PONZILOVO_9', 'Via Ponzilovo 9'),
      property('FIAT_PUNTO_EJ560PZ', 'Fiat Punto EJ560PZ'),
      { id: 'PONZILOVO_NEWS', title: 'Ponzilovo news', dimension: null },
    ];
    const homes = [
      {
        ...ponzilovo,
        address: 'Via Ponzilovo 9',
        categoryIds: ['VIA_PONZILOVO'],
      },
      { ...bandi, address: 'Via dei Bandi, 10', categoryIds: [] },
    ];
    const plan = planPropertyTidy(homes, categories);
    expect(plan.merges.map((m) => [m.from.id, m.into.id])).toEqual([
      ['VIA_PONZILOVO', 'VIA_PONZILOVO_9'],
    ]);
    expect(plan.links.get(0)?.id).toBe('VIA_PONZILOVO_9');
    // No category for Via dei Bandi yet: it is created, named by its address.
    expect(plan.links.has(1)).toBe(false);
    expect(plan.vehicles.map((v) => v.id)).toEqual(['FIAT_PUNTO_EJ560PZ']);
    expect(plan.renames).toEqual([]);
    expect(
      propertyCategoryRequest(
        { ...homes[1], city: 'Tregnago' },
        'VIA_DEI_BANDI_10',
      ).title,
    ).toBe('Via dei Bandi, 10');
  });

  it('renames a street-only category to the full address, and is a no-op once tidy', () => {
    const homes = [
      {
        ...ponzilovo,
        address: 'Via Ponzilovo 9',
        categoryIds: ['VIA_PONZILOVO'],
      },
    ];
    const street: CategoryLike = {
      id: 'VIA_PONZILOVO',
      title: 'Via Ponzilovo',
      dimension: 'PROPERTY',
    };
    expect(planPropertyTidy(homes, [street]).renames).toEqual([
      { id: 'VIA_PONZILOVO', title: 'Via Ponzilovo 9' },
    ]);
    const tidy = planPropertyTidy(homes, [
      { ...street, title: 'Via Ponzilovo 9' },
    ]);
    expect([tidy.merges, tidy.renames, tidy.vehicles]).toEqual([[], [], []]);
  });

  it('never merges a category that names two homes', () => {
    const plan = planPropertyTidy(
      [
        {
          name: 'Casa al lago',
          address: 'Via Roma 1',
          matchTerms: ['roma'],
          categoryIds: [],
        },
        {
          name: 'Casa in centro',
          address: 'Via Roma 3',
          matchTerms: ['roma'],
          categoryIds: [],
        },
      ],
      [
        { id: 'ROMA', title: 'Roma', dimension: 'PROPERTY' },
        { id: 'VIA_ROMA_1', title: 'Via Roma 1', dimension: 'PROPERTY' },
      ],
    );
    expect(plan.merges).toEqual([]);
    expect(plan.links.get(0)?.id).toBe('VIA_ROMA_1');
    expect(plan.links.has(1)).toBe(false);
  });
});
