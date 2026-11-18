import type { SubscriptionDto } from '@life-island/contracts';
import { costHistory, priceOn } from './cost-history';

const item = (o: Partial<SubscriptionDto>) =>
  ({
    id: o.name,
    status: 'active',
    cycle: 'monthly',
    startOn: null,
    priceChanges: [],
    ...o,
  }) as SubscriptionDto;

describe('the fixed cost over time', () => {
  const netflix = item({
    name: 'Netflix',
    cost: 13.99,
    startOn: '2025-03-10',
    priceChanges: [{ date: '2026-06-01', from: 12.99, to: 13.99 }],
  });
  const insurance = item({
    name: 'Home insurance',
    cost: 240,
    cycle: 'yearly',
  });
  const gym = item({ name: 'Gym', cost: 50, status: 'cancelled' });

  it('reads the price a contract had on a day', () => {
    expect(priceOn(netflix, '2026-05-31')).toBe(12.99);
    expect(priceOn(netflix, '2026-06-01')).toBe(13.99);
  });

  it('adds each contract from its start, a year spread over twelve months', () => {
    const months = costHistory([netflix, insurance, gym], '2026-11-18', 24);
    expect(months).toHaveLength(24);
    expect(months[0]).toEqual({ month: '2024-12', total: 20, changes: [] });
    const march = months.find((m) => m.month === '2025-03');
    expect(march).toEqual({
      month: '2025-03',
      total: 32.99,
      changes: ['Netflix started'],
    });
    const june = months.find((m) => m.month === '2026-06');
    expect(june?.total).toBe(33.99);
    expect(june?.changes).toEqual(['Netflix went up']);
    expect(months.at(-1)?.month).toBe('2026-11');
  });
});
