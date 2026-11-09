import { withoutChangedParties } from './cars.service.js';

describe('people of a car', () => {
  const linked = {
    'parties.holder.name': 'a0000000-0000-4000-8000-000000000001',
    'parties.owner.name': 'a0000000-0000-4000-8000-000000000002',
  } as const;

  it('drops the link of a party whose name changes, and keeps the others', () => {
    expect(
      withoutChangedParties(linked, {
        'parties.holder.name': 'VALENTINA SCANDOLARA',
        colour: 'BIANCO',
      }),
    ).toEqual({ 'parties.owner.name': linked['parties.owner.name'] });
  });

  it('keeps every link when no name changes, and copes with none', () => {
    expect(withoutChangedParties(linked, { colour: 'BIANCO' })).toEqual(linked);
    expect(withoutChangedParties(null, {})).toEqual({});
  });
});
