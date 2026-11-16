import type { DeadlineDto } from '@life-island/contracts';
import { buildEntries, openEntries } from './timeline.js';

const deadline = (over: Partial<DeadlineDto>): DeadlineDto => ({
  id: 'bill:1:2026-10-01',
  module: 'home',
  kind: 'bill',
  title: 'Electricity bill due',
  detail: null,
  date: '2026-10-01',
  amount: 80,
  path: '/home',
  ...over,
});

describe('auto-paid deadlines', () => {
  const entries = buildEntries({
    today: '2026-11-16',
    window: { from: '2026-09-01', to: '2026-12-31' },
    deadlines: [
      deadline({ id: 'paid', autoPaid: true }),
      deadline({ id: 'to-pay' }),
      deadline({ id: 'soon', date: '2026-11-20', autoPaid: true }),
    ],
    items: [],
    calendar: false,
    handled: new Set(),
  });

  it('are handled on their own, never late or coming up', () => {
    const byId = new Map(entries.map((e) => [e.key.split(':')[2], e]));
    expect(byId.get('paid')).toMatchObject({ handled: true, autoPaid: true });
    expect(byId.get('to-pay')).toMatchObject({
      handled: false,
      autoPaid: false,
    });
    expect(openEntries(entries, 30).map((e) => e.key)).toEqual([
      'module:home:to-pay',
    ]);
  });
});
