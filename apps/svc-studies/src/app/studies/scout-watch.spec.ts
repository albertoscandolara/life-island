import { LEARNING_PATHS } from '@life-island/contracts';
import { monthStart, nextToScan, scoutWatches } from './scout-watch.js';

const scan = (
  pathId: string,
  status: 'done' | 'error' | 'running',
  startedAt: string,
) => ({
  id: `${pathId}-${status}`,
  pathId,
  reason: 'schedule' as const,
  status,
  stepIds: [],
  found: 0,
  flagged: 0,
  proposed: 0,
  error: null,
  model: null,
  startedAt,
  finishedAt: null,
});

describe('the scout watch', () => {
  const watches = scoutWatches({
    catalogue: LEARNING_PATHS,
    rows: [
      { pathId: 'ai-coding', status: 'following', scoutWatch: true },
      { pathId: 'leadership', status: 'following', scoutWatch: true },
      { pathId: '3d', status: 'paused', scoutWatch: true },
      { pathId: 'finance', status: 'following', scoutWatch: false },
    ],
    lastDone: new Map([
      ['ai-coding', '2026-08-01T10:00:00Z'],
      ['leadership', '2026-11-01T10:00:00Z'],
    ]),
    latest: new Map([
      ['ai-coding', scan('ai-coding', 'done', '2026-08-01T10:00:00Z')],
    ]),
    cadence: 'auto',
    today: '2026-11-27',
  });

  it('watches the paths you follow, each on the cadence of its topic', () => {
    expect(watches.map((w) => [w.pathId, w.watching, w.nextScanOn])).toEqual([
      ['ai-coding', true, '2026-10-01'],
      ['leadership', true, '2027-05-01'],
      ['finance', false, null],
    ]);
  });

  it('scans the path due longest ago, within the month’s scans', () => {
    const now = new Date('2026-11-27T12:00:00Z');
    expect(
      nextToScan({
        watches,
        scansThisMonth: 1,
        monthlyScans: 4,
        now,
        retryMs: 0,
      }),
    ).toBe('ai-coding');
    expect(
      nextToScan({
        watches,
        scansThisMonth: 4,
        monthlyScans: 4,
        now,
        retryMs: 0,
      }),
    ).toBeNull();
  });

  it('waits after a failed scan, and never starts one while it runs', () => {
    const now = new Date('2026-11-27T12:00:00Z');
    const failed = watches.map((w) =>
      w.pathId === 'ai-coding'
        ? { ...w, lastScan: scan('ai-coding', 'error', '2026-11-27T10:00:00Z') }
        : w,
    );
    expect(
      nextToScan({
        watches: failed,
        scansThisMonth: 0,
        monthlyScans: 4,
        now,
        retryMs: 12 * 3600_000,
      }),
    ).toBeNull();
    const running = watches.map((w) =>
      w.pathId === 'ai-coding'
        ? {
            ...w,
            lastScan: scan('ai-coding', 'running', '2026-11-27T11:00:00Z'),
          }
        : w,
    );
    expect(
      nextToScan({
        watches: running,
        scansThisMonth: 0,
        monthlyScans: 4,
        now,
        retryMs: 0,
      }),
    ).toBeNull();
  });

  it('counts the month from its first day', () => {
    expect(monthStart(new Date('2026-11-27T12:00:00Z')).toISOString()).toBe(
      '2026-11-01T00:00:00.000Z',
    );
  });
});
