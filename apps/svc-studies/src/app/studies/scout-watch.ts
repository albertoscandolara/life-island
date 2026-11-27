import {
  nextScanOn,
  scoutCadenceMonths,
  type LearningPath,
  type PathStatus,
  type ScoutScanDto,
  type ScoutWatchDto,
  type StudyScoutCadence,
} from '@life-island/contracts';

/*
 * Which paths the resource scout keeps current, and which one it scans next:
 * every path you follow (unless you stopped it for one), each on its
 * cadence, within a number of scans a calendar month, the most overdue first.
 */

export interface WatchRow {
  pathId: string;
  status: PathStatus;
  scoutWatch: boolean;
}

/** Every path you follow, with when the scout scans it next. */
export function scoutWatches(input: {
  catalogue: readonly LearningPath[];
  rows: readonly WatchRow[];
  /** The latest finished scan of each path. */
  lastDone: ReadonlyMap<string, string>;
  /** The latest scan of each path, in any state. */
  latest: ReadonlyMap<string, ScoutScanDto>;
  cadence: StudyScoutCadence;
  today: string;
}): ScoutWatchDto[] {
  return input.catalogue.flatMap((path) => {
    const row = input.rows.find((r) => r.pathId === path.id);
    if (row?.status !== 'following') return [];
    const months = scoutCadenceMonths(input.cadence, path.topic);
    const done = input.lastDone.get(path.id);
    return [
      {
        pathId: path.id,
        watching: row.scoutWatch,
        cadenceMonths: months,
        nextScanOn: row.scoutWatch
          ? done
            ? nextScanOn(done, months)
            : input.today
          : null,
        lastScan: input.latest.get(path.id) ?? null,
      },
    ];
  });
}

/**
 * The path to scan now, or null: a watched path that is due, not scanning,
 * and not failed in the last `retryMs`; the one due longest ago goes first
 * (a path never scanned is due today). Nothing when the month's scans are
 * used up.
 */
export function nextToScan(input: {
  watches: readonly ScoutWatchDto[];
  scansThisMonth: number;
  monthlyScans: number;
  now: Date;
  retryMs: number;
}): string | null {
  if (input.scansThisMonth >= input.monthlyScans) return null;
  const today = input.now.toISOString().slice(0, 10);
  const due = input.watches.filter((w) => {
    if (!w.watching || !w.nextScanOn || w.nextScanOn > today) return false;
    const last = w.lastScan;
    if (last?.status === 'running') return false;
    return !(
      last?.status === 'error' &&
      input.now.getTime() - new Date(last.startedAt).getTime() < input.retryMs
    );
  });
  due.sort((a, b) => (a.nextScanOn ?? '').localeCompare(b.nextScanOn ?? ''));
  return due[0]?.pathId ?? null;
}

/** The first day of the month of `now`, in UTC: scans since then count. */
export function monthStart(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}
