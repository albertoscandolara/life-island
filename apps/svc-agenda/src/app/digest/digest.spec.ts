import type { AgendaEntryDto, AgendaWaitingDto } from '@life-island/contracts';
import { buildDigest, DIGEST_SECTION_LIMIT, whenText } from './digest.js';

const entry = (over: Partial<AgendaEntryDto>): AgendaEntryDto => ({
  key: 'module:cars:x',
  source: 'module',
  module: 'cars',
  kind: 'insurance',
  title: 'Insurance of the Panda',
  detail: null,
  date: '2026-11-21',
  time: null,
  amount: 420,
  path: '/cars',
  daysLeft: 3,
  urgency: 'week',
  handled: false,
  autoPaid: false,
  itemId: null,
  category: null,
  ...over,
});

const waiting: AgendaWaitingDto = {
  key: 'people:document:1',
  module: 'people',
  id: 'document:1',
  kind: 'document',
  title: 'Carta identità.pdf',
  detail: null,
  since: '2026-11-10',
  path: '/people',
  action: 'Review',
};

const input = {
  today: '2026-11-18',
  frequency: 'weekly' as const,
  appUrl: 'https://island.example',
  name: 'Mario',
};

describe('buildDigest', () => {
  it('lists the overdue, the coming and the waiting, linked to their pages', () => {
    const digest = buildDigest({
      ...input,
      entries: [
        entry({}),
        entry({
          key: 'item:1:2026-11-16',
          source: 'item',
          module: 'agenda',
          title: 'Call the plumber <now>',
          date: '2026-11-16',
          daysLeft: -2,
          amount: null,
          path: null,
        }),
        // Handled, or beyond the week: not in a weekly digest.
        entry({ key: 'h', handled: true }),
        entry({ key: 'far', daysLeft: 12, date: '2026-11-30' }),
      ],
      waiting: [waiting],
    });
    expect(digest.subject).toBe(
      'Life Island: 1 overdue, 1 this week, 1 waiting for you',
    );
    expect(digest.heading).toBe('Wednesday 18 November');
    expect(digest.empty).toBe(false);
    expect(digest.overdue).toEqual([
      expect.objectContaining({
        area: 'Agenda',
        url: 'https://island.example/agenda',
      }),
    ]);
    expect(digest.coming).toEqual([
      expect.objectContaining({
        area: 'Cars',
        amount: 420,
        url: 'https://island.example/cars',
      }),
    ]);
    expect(digest.waiting[0]).toMatchObject({ area: 'People & IDs' });
    expect(digest.text).toContain('Hi Mario,');
    expect(digest.text).toContain('2 days late · Agenda: Call the plumber');
    expect(digest.text).toContain('420,00 €');
    // What a page or a document wrote is escaped in the HTML.
    expect(digest.html).toContain('Call the plumber &lt;now&gt;');
    expect(digest.html).not.toContain('<now>');
    expect(digest.html).toContain('href="https://island.example/settings"');
  });

  it('looks 3 days ahead every day and a month ahead every month', () => {
    const entries = [entry({ daysLeft: 3 }), entry({ key: 'b', daysLeft: 20 })];
    expect(
      buildDigest({ ...input, frequency: 'daily', entries, waiting: [] })
        .coming,
    ).toHaveLength(1);
    expect(
      buildDigest({ ...input, frequency: 'monthly', entries, waiting: [] })
        .coming,
    ).toHaveLength(2);
  });

  it('says when nothing needs you', () => {
    const digest = buildDigest({ ...input, entries: [], waiting: [] });
    expect(digest.empty).toBe(true);
    expect(digest.subject).toBe('Life Island: nothing needs you');
  });

  it('never links outside the island, and counts what does not fit', () => {
    const many = Array.from({ length: DIGEST_SECTION_LIMIT + 2 }, (_, i) =>
      entry({ key: `k${i}`, path: i === 0 ? 'https://evil.example' : '/cars' }),
    );
    const digest = buildDigest({ ...input, entries: many, waiting: [] });
    expect(digest.coming[0].url).toBeNull();
    expect(digest.text).toContain('…and 2 more in the Agenda.');
  });

  it('says when a date is', () => {
    const line = {
      area: 'Cars',
      emblem: '🚗',
      title: 't',
      detail: null,
      amount: null,
      url: null,
    };
    expect(whenText({ ...line, date: '2026-11-18', daysLeft: 0 })).toBe(
      'Today',
    );
    expect(whenText({ ...line, date: '2026-11-19', daysLeft: 1 })).toBe(
      'Tomorrow',
    );
    expect(whenText({ ...line, date: '2026-11-23', daysLeft: 5 })).toBe(
      'Mon 23 Nov',
    );
    expect(whenText({ ...line, date: '2026-11-10', daysLeft: null })).toBe(
      'Since 10 Nov',
    );
  });
});
