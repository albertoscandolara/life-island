import { LEARNING_PATHS } from '@life-island/contracts';
import { studyAttentionItems } from './attention.js';

const scout = {
  cadence: 'auto' as const,
  watched: [],
  monthlyScans: 4,
  scansThisMonth: 0,
  ai: true,
  lastScan: null,
  paces: {},
  proposals: [],
  resources: [],
};

const resource = (over: object) => ({
  id: 'r',
  pathId: 'ai-coding',
  stepId: 'ai-coding.daily.review',
  title: 'A guide',
  url: 'https://example.com',
  kind: 'docs' as const,
  publishedOn: null,
  free: true,
  why: 'Current.',
  status: 'suggested' as const,
  outdated: null,
  foundAt: '2026-11-20T10:00:00Z',
  ...over,
});

describe('studyAttentionItems', () => {
  it('lists what the scout found, one line per path, opening that path', () => {
    const items = studyAttentionItems({
      catalogue: [...LEARNING_PATHS],
      paths: [],
      reminders: [],
      scout: {
        ...scout,
        resources: [
          resource({ id: 'a' }),
          resource({ id: 'b', foundAt: '2026-11-18T10:00:00Z' }),
          resource({ id: 'c', status: 'pinned', outdated: 'Old API' }),
          resource({ id: 'd', status: 'pinned' }),
        ],
      },
    });
    expect(items).toEqual([
      {
        id: 'scout:ai-coding',
        kind: 'scout',
        title: 'Review what the scout found for AI coding and tools',
        detail: '2 new resources, 1 outdated',
        since: '2026-11-18',
        path: '/studies?tab=fresh',
        action: 'Review',
      },
    ]);
  });

  it('turns a path behind its target and idle weeks into lines with a button', () => {
    const items = studyAttentionItems({
      catalogue: [...LEARNING_PATHS],
      paths: [],
      scout,
      reminders: [
        {
          kind: 'target',
          refId: 'leadership',
          title: 'Becoming a team leader: behind your target',
          detail: 'Give it more time.',
          date: '2027-04-30',
          daysLeft: 150,
          severity: 'info',
        },
        {
          kind: 'idle',
          refId: null,
          title: 'No study time for 20 days',
          detail: 'Even 25 minutes keeps a path alive.',
          date: null,
          daysLeft: null,
          severity: 'info',
        },
      ],
    });
    expect(items.map((i) => [i.id, i.path, i.action])).toEqual([
      ['target:leadership', '/studies?tab=paths&path=leadership', 'Plan it'],
      ['idle', '/studies#studies-next', 'Study now'],
    ]);
  });
});
