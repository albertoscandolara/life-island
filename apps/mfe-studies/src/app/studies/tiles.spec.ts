import {
  LEARNING_PATHS,
  type StudiesOverviewDto,
} from '@life-island/contracts';
import { monthOf, studiesTiles } from './tiles';
import { sessionMinutes } from './timer';

const path = (over: object) => ({
  pathId: 'ai-coding',
  status: 'following',
  startedOn: null,
  targetOn: null,
  steps: [],
  doneSteps: 0,
  totalSteps: 16,
  hoursDone: 0,
  hoursTotal: 78,
  minutesLogged: 0,
  nextStepId: null,
  projectedOn: null,
  behind: false,
  ...over,
});

const data = {
  stats: { weeklyGoalHours: 5, weekMinutes: 150, streakWeeks: 0 },
  catalogue: [...LEARNING_PATHS],
  courses: [
    { status: 'completed', completedOn: '2026-11-03' },
    { status: 'in_progress', completedOn: null },
  ],
  certifications: [{ status: 'passed', obtainedOn: '2025-05-01' }],
  paths: [
    path({
      doneSteps: 3,
      steps: [
        { stepId: 'a', status: 'done', doneOn: '2026-11-02' },
        { stepId: 'b', status: 'done', doneOn: '2026-10-20' },
        { stepId: 'c', status: 'done', doneOn: '2026-10-01' },
        { stepId: 'd', status: 'doing', doneOn: null },
      ],
    }),
    path({ pathId: 'leadership', behind: true, totalSteps: 12 }),
    path({ pathId: '3d', status: 'paused' }),
  ],
} as unknown as StudiesOverviewDto;

describe('studiesTiles', () => {
  it('compares this month with the last, and names the paths behind', () => {
    const t = studiesTiles(data, '2026-11-27');
    expect(t.week).toEqual({ minutes: 150, goalMinutes: 300, share: 50 });
    expect(t.steps).toEqual({ thisMonth: 1, lastMonth: 2, open: 25 });
    expect(t.onTrack).toEqual({
      following: 2,
      onTrack: 1,
      behind: ['Becoming a team leader'],
    });
    expect(t.proof).toEqual({
      total: 2,
      courses: 1,
      certificates: 1,
      thisYear: 1,
    });
  });

  it('moves across the year', () => {
    expect(monthOf('2026-01-15', -1)).toBe('2025-12');
  });
});

describe('sessionMinutes', () => {
  it('rounds to five minutes, at least five', () => {
    expect(sessionMinutes(60_000)).toBe(5);
    expect(sessionMinutes(48 * 60_000)).toBe(50);
    expect(sessionMinutes(20 * 3600_000)).toBe(960);
  });
});
