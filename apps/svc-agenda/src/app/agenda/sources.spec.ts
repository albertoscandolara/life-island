import type { AgendaEntryDto, AgendaWaitingDto } from '@life-island/contracts';
import { readWaiting } from './sources.js';
import { briefDossier, offlineBrief } from './timeline.js';

const answer = (body: unknown, ok = true) =>
  ({ ok, status: ok ? 200 : 500, json: async () => body }) as Response;

describe('readWaiting', () => {
  it('lists every area’s undated items, oldest first, and skips what does not answer', async () => {
    const fetcher = (async (url: string) => {
      if (url.startsWith('http://cars'))
        return answer({
          expired: 0,
          expiring: 0,
          toReview: 1,
          items: [
            {
              id: 'document:u1',
              kind: 'document',
              title: 'Polizza.pdf',
              detail: null,
              since: '2026-11-10T08:00:00.000Z',
              path: '/cars',
              action: 'Review',
            },
          ],
        });
      if (url.startsWith('http://groceries'))
        return answer({
          expired: 0,
          expiring: 1,
          toReview: 0,
          items: [
            {
              id: 'running-out:milk',
              kind: 'running-out',
              title: 'Milk is probably running out',
              detail: null,
              since: '2026-11-02',
              path: '/groceries',
              action: 'Add to list',
            },
            // Not a link inside the app: left out.
            { id: 'x', kind: 'x', title: 'x', path: 'https://x', action: 'Go' },
          ],
        });
      if (url.startsWith('http://work')) throw new Error('fetch failed');
      return answer({ expired: 0, expiring: 0, toReview: 0 });
    }) as typeof fetch;
    const waiting = await readWaiting(
      {
        cars: 'http://cars',
        groceries: 'http://groceries',
        work: 'http://work',
        people: 'http://people',
      },
      fetcher,
    );
    expect(waiting.map((w) => [w.key, w.since])).toEqual([
      ['groceries:running-out:milk', '2026-11-02'],
      ['cars:document:u1', '2026-11-10'],
    ]);
  });
});

describe('the week brief with what waits for you', () => {
  const waiting: AgendaWaitingDto[] = [
    {
      key: 'cars:document:u1',
      module: 'cars',
      id: 'document:u1',
      kind: 'document',
      title: 'Polizza.pdf',
      detail: 'Insurance policy',
      since: '2026-11-10',
      path: '/cars',
      action: 'Review',
    },
  ];
  const overdue = {
    module: 'money',
    title: 'Pay the rent',
    date: '2026-11-15',
    daysLeft: -2,
    handled: false,
    amount: null,
    detail: null,
  } as AgendaEntryDto;

  it('sends the undated things to the model after the dates', () => {
    const text = briefDossier(
      '2026-11-17',
      [overdue],
      { cars: 'Cars' },
      waiting,
    );
    expect(text).toContain('Waiting for you, with no date:');
    expect(text).toContain(
      '- Cars · Polizza.pdf · waiting since 2026-11-10 — Insurance policy',
    );
  });

  it('puts them after what is overdue in the offline brief', () => {
    const brief = offlineBrief([overdue], { cars: 'Cars' }, waiting);
    expect(brief.priorities.map((p) => p.title)).toEqual([
      'Pay the rent',
      'Polizza.pdf',
    ]);
    expect(brief.summary).toContain('1 thing with no date waits for you too.');
  });
});
