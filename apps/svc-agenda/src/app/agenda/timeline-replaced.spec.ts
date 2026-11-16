import { buildEntries } from './timeline.js';

/*
 * The 730 deadline of the calendar is a fixed 30 September; the 730 area
 * knows the form you file (Redditi PF is due on 31 October) and whether the
 * return is filed, so while it answers the calendar leaves the date to it.
 */
describe('a calendar date an area publishes itself', () => {
  const build = (answered: string[]) =>
    buildEntries({
      today: '2026-11-16',
      window: { from: '2026-09-17', to: '2026-12-31' },
      deadlines: answered.includes('taxes')
        ? [
            {
              id: 'return-2025',
              module: 'taxes',
              kind: 'tax-return',
              title: 'Redditi PF deadline (2025 income)',
              detail: null,
              date: '2026-11-02',
              amount: null,
              path: '/taxes/730',
              done: true,
            },
          ]
        : [],
      items: [],
      calendar: true,
      handled: new Set(),
      answered: new Set(answered),
    });

  it('is left to the area while it answers, and done once it says so', () => {
    const entries = build(['taxes']);
    expect(entries.some((e) => e.key.startsWith('calendar:730-deadline'))).toBe(
      false,
    );
    expect(
      entries.find((e) => e.key === 'module:taxes:return-2025'),
    ).toMatchObject({ handled: true, autoPaid: false, daysLeft: -14 });
  });

  it('comes back from the calendar when the area does not answer', () => {
    const entries = build([]);
    expect(
      entries.find((e) => e.key === 'calendar:730-deadline:2026'),
    ).toMatchObject({ handled: false, date: '2026-09-30' });
  });
});
