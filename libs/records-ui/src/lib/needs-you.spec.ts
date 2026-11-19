import type { AgendaEntryDto, AgendaWaitingDto } from '@life-island/contracts';
import { euro } from './format';
import { needsYouLines } from './needs-you';

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
  key: 'cars:document:1',
  module: 'cars',
  id: 'document:1',
  kind: 'document',
  title: 'Polizza RCA.pdf',
  detail: null,
  since: '2026-11-10',
  path: '/cars?review=documents',
  action: 'Review',
};

describe('needsYouLines', () => {
  const lines = needsYouLines(
    {
      entries: [
        entry({}),
        entry({ key: 'late', title: 'Road tax', daysLeft: -2, amount: null }),
        entry({ key: 'done', handled: true }),
        entry({ key: 'other', path: '/home?property=1', daysLeft: 5 }),
      ],
      waiting: [waiting],
    },
    '/cars?vehicle=1',
  );

  it('puts late dates first, then what waits, then what is coming', () => {
    expect(lines.map((l) => l.key)).toEqual([
      'late',
      'cars:document:1',
      'module:cars:x',
      'other',
    ]);
  });

  it('opens a place only when it is not this page, and marks dates done', () => {
    const [late, wait, coming, other] = lines;
    expect(late.open).toBeNull();
    expect(late.doneKey).toBe('late');
    expect(wait).toMatchObject({
      daysLeft: null,
      doneKey: null,
      open: {
        label: 'Review',
        path: '/cars',
        query: { review: 'documents' },
        fragment: undefined,
      },
    });
    expect(coming.meta).toEqual([euro(420)]);
    expect(other.open).toEqual({
      label: 'Open',
      path: '/home',
      query: { property: '1' },
      fragment: undefined,
    });
  });

  it('opens a block further down this very page', () => {
    const [line] = needsYouLines(
      {
        entries: [],
        waiting: [{ ...waiting, path: '/work?tab=review' }],
      },
      '/work',
    );
    expect(line.open).toEqual({
      label: 'Review',
      path: '/work',
      query: { tab: 'review' },
      fragment: undefined,
    });
    const [here] = needsYouLines(
      { entries: [entry({ path: '/cars#cars-review' })], waiting: [] },
      '/cars',
    );
    expect(here.open).toMatchObject({ path: '/cars', fragment: 'cars-review' });
  });

  it('offers to load the proof, not Done, for a date a document closes', () => {
    const [line] = needsYouLines(
      {
        entries: [
          entry({ key: 'ins', proof: 'the new insurance certificate' }),
        ],
        waiting: [],
      },
      '/cars',
    );
    expect(line.doneKey).toBeNull();
    expect(line.proof).toEqual({
      module: 'cars',
      title: 'Insurance of the Panda',
      proof: 'the new insurance certificate',
    });
  });
});
