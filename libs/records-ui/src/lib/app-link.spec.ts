import { appLink } from './app-link';

describe('appLink', () => {
  it('splits a path, its query and the block it points to', () => {
    expect(appLink('/work?tab=review')).toEqual({
      path: '/work',
      query: { tab: 'review' },
      fragment: undefined,
    });
    expect(appLink('/taxes/730?year=2025&view=expenses#payment-pairs')).toEqual(
      {
        path: '/taxes/730',
        query: { year: '2025', view: 'expenses' },
        fragment: 'payment-pairs',
      },
    );
    expect(appLink('/groceries?add=Latte%20intero#shopping-list')).toEqual({
      path: '/groceries',
      query: { add: 'Latte intero' },
      fragment: 'shopping-list',
    });
    expect(appLink('/cars')).toEqual({
      path: '/cars',
      query: {},
      fragment: undefined,
    });
  });
});
