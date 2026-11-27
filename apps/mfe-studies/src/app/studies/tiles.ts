import {
  learningPath,
  type LearningPath,
  type StudiesOverviewDto,
} from '@life-island/contracts';

/*
 * The four tiles of Studies, without the template: each number with what it
 * is compared to (design guidelines, "Where you stand").
 */

export interface StudiesTiles {
  week: {
    minutes: number;
    goalMinutes: number;
    /** Percent of the goal, at most 100. */
    share: number;
  };
  steps: { thisMonth: number; lastMonth: number; open: number };
  onTrack: { following: number; onTrack: number; behind: string[] };
  proof: {
    total: number;
    courses: number;
    certificates: number;
    thisYear: number;
  };
}

/** YYYY-MM of `today` moved by `months`. */
export function monthOf(today: string, months = 0): string {
  const [y, m] = today.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + months, 1));
  return d.toISOString().slice(0, 7);
}

export function studiesTiles(
  data: StudiesOverviewDto,
  today = new Date().toISOString().slice(0, 10),
): StudiesTiles {
  const s = data.stats;
  const goalMinutes = s.weeklyGoalHours * 60;
  const month = monthOf(today);
  const lastMonth = monthOf(today, -1);
  const done = data.paths.flatMap((p) =>
    p.steps.filter((st) => st.status === 'done' && st.doneOn),
  );
  const following = data.paths.filter((p) => p.status === 'following');
  const year = today.slice(0, 4);
  const courses = data.courses.filter((c) => c.status === 'completed');
  const certificates = data.certifications.filter((c) => c.status === 'passed');
  const nameOf = (id: string) =>
    learningPath(id, data.catalogue as readonly LearningPath[])?.name ?? id;
  return {
    week: {
      minutes: s.weekMinutes,
      goalMinutes,
      share: goalMinutes
        ? Math.min(100, Math.round((s.weekMinutes / goalMinutes) * 100))
        : 0,
    },
    steps: {
      thisMonth: done.filter((st) => (st.doneOn ?? '').startsWith(month))
        .length,
      lastMonth: done.filter((st) => (st.doneOn ?? '').startsWith(lastMonth))
        .length,
      open: following.reduce((sum, p) => sum + p.totalSteps - p.doneSteps, 0),
    },
    onTrack: {
      following: following.length,
      onTrack: following.filter((p) => !p.behind).length,
      behind: following.filter((p) => p.behind).map((p) => nameOf(p.pathId)),
    },
    proof: {
      total: courses.length + certificates.length,
      courses: courses.length,
      certificates: certificates.length,
      thisYear:
        courses.filter((c) => c.completedOn?.startsWith(year)).length +
        certificates.filter((c) => c.obtainedOn?.startsWith(year)).length,
    },
  };
}
