import { categoryDecisions } from './document-changes';

describe('categoryDecisions', () => {
  it('confirms what is ticked (all at first) and declines the rest', () => {
    expect(
      categoryDecisions(['s1', 's2'], { s2: false }, ['TAX', 'MEDICAL'], {
        MEDICAL: false,
      }),
    ).toEqual({
      approveSuggestions: ['s1'],
      declineSuggestions: ['s2'],
      acceptHistorical: ['TAX'],
      rejectHistorical: ['MEDICAL'],
    });
  });

  it('has nothing to send when there is nothing to decide', () => {
    expect(categoryDecisions([], {}, [], {})).toBeUndefined();
  });
});
