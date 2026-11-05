import {
  categoryIdFor,
  findPropertyCategory,
  propertyCategoryRequest,
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
      title: 'Via dei Bandi',
      dimension: 'PROPERTY',
    });
    expect(request.description).toContain('Via dei Bandi 4, Tregnago');
    expect(request.description).toContain(
      'never by the address a bill is mailed to',
    );
  });
});
