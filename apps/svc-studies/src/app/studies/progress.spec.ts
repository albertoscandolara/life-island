import {
  STUDY_REMINDER_DEFAULTS,
  type CertificationDto,
  type StudySessionDto,
  type TrainingPlatformDto,
} from '@life-island/contracts';
import {
  addDays,
  nextRenewal,
  pathProgress,
  pathsProgress,
  streakWeeks,
  studyReminders,
  studyWeeks,
  subscriptionSpend,
  weekStart,
  yearlyCost,
} from './progress.js';
import { LEARNING_PATHS } from '@life-island/contracts';

const TODAY = '2026-11-11'; // a Wednesday

const session = (
  date: string,
  minutes: number,
  extra: Partial<StudySessionDto> = {},
): StudySessionDto => ({
  id: `${date}-${minutes}`,
  date,
  minutes,
  topic: 'ai',
  pathId: null,
  stepId: null,
  courseId: null,
  note: null,
  ...extra,
});

const platform = (
  extra: Partial<TrainingPlatformDto> = {},
): TrainingPlatformDto => ({
  id: 'p1',
  name: 'Frontend Masters',
  url: 'https://frontendmasters.com/',
  account: null,
  plan: 'subscription',
  status: 'active',
  price: 39,
  billingPeriod: 'month',
  renewsOn: '2026-11-20',
  yearlyCost: 468,
  topics: [],
  notes: null,
  lastOpenedAt: null,
  createdAt: '2025-01-01T00:00:00.000Z',
  courses: 0,
  ...extra,
});

const exam = (extra: Partial<CertificationDto> = {}): CertificationDto => ({
  id: 'c1',
  name: 'CKAD',
  provider: null,
  topic: 'infrastructure',
  status: 'booked',
  examOn: '2026-11-25',
  cost: 395,
  obtainedOn: null,
  expiresOn: null,
  credentialUrl: null,
  notes: null,
  createdAt: '2026-10-01T00:00:00.000Z',
  ...extra,
});

describe('dates', () => {
  it('finds the Monday of a week', () => {
    expect(weekStart('2026-11-11')).toBe('2026-11-09');
    expect(weekStart('2026-11-09')).toBe('2026-11-09');
    expect(weekStart('2026-11-15')).toBe('2026-11-09');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
  });

  it('moves a past renewal on by its period', () => {
    expect(nextRenewal('2026-01-05', 'month', TODAY)).toBe('2026-12-05');
    expect(nextRenewal('2025-03-01', 'year', TODAY)).toBe('2027-03-01');
    expect(nextRenewal('2026-12-01', 'year', TODAY)).toBe('2026-12-01');
    expect(nextRenewal(null, 'year', TODAY)).toBeNull();
  });

  it('prices a subscription by the year', () => {
    expect(
      yearlyCost({ plan: 'subscription', price: 10, billingPeriod: 'month' }),
    ).toBe(120);
    expect(
      yearlyCost({ plan: 'subscription', price: 99, billingPeriod: 'year' }),
    ).toBe(99);
    expect(yearlyCost({ plan: 'free', price: 10, billingPeriod: null })).toBe(
      null,
    );
  });
});

describe('weeks and streak', () => {
  it('counts minutes per week and topic, and the goal', () => {
    const weeks = studyWeeks(
      [
        session('2026-11-09', 120),
        session('2026-11-10', 90, { topic: '3d' }),
        session('2026-11-03', 60),
      ],
      180,
      TODAY,
      3,
    );
    expect(weeks.map((w) => w.weekStart)).toEqual([
      '2026-10-26',
      '2026-11-02',
      '2026-11-09',
    ]);
    expect(weeks[2].minutes).toBe(210);
    expect(weeks[2].byTopic).toEqual({ ai: 120, '3d': 90 });
    expect(weeks[2].goalMet).toBe(true);
    expect(weeks[1].goalMet).toBe(false);
  });

  it('never lets the unfinished week break the streak', () => {
    const w = (goalMet: boolean) => ({
      weekStart: '',
      minutes: 0,
      byTopic: {},
      goalMet,
    });
    expect(streakWeeks([w(false), w(true), w(true), w(false)])).toBe(2);
    expect(streakWeeks([w(true), w(true), w(true)])).toBe(3);
    expect(streakWeeks([w(true), w(false), w(false)])).toBe(0);
  });
});

describe('subscriptions spend', () => {
  it('adds the renewals that fell this year', () => {
    // Monthly from 20 Jan: 20 Jan…20 Oct = 10 payments by 11 Nov.
    expect(
      subscriptionSpend(
        [platform({ renewsOn: '2026-11-20', price: 10 })],
        TODAY,
      ),
    ).toBe(100);
    expect(
      subscriptionSpend(
        [
          platform({
            renewsOn: '2027-03-01',
            billingPeriod: 'year',
            price: 99,
          }),
        ],
        TODAY,
      ),
    ).toBe(99);
    expect(subscriptionSpend([platform({ plan: 'free' })], TODAY)).toBe(0);
  });
});

describe('path progress', () => {
  const ai = LEARNING_PATHS.find((p) => p.id === 'ai-coding')!;
  const first = ai.stages[0].steps[0];

  it('counts steps and hours, and finds the next step', () => {
    const progress = pathProgress(
      ai,
      { pathId: ai.id, status: 'following', startedOn: TODAY, targetOn: null },
      [
        {
          stepId: first.id,
          status: 'done',
          startedOn: TODAY,
          doneOn: TODAY,
          notes: null,
        },
      ],
      [],
      [{ pathId: ai.id, stepId: first.id, minutes: 120 }],
      5,
      TODAY,
    );
    expect(progress.doneSteps).toBe(1);
    expect(progress.hoursDone).toBe(first.hours);
    expect(progress.nextStepId).toBe(ai.stages[0].steps[1].id);
    expect(progress.minutesLogged).toBe(120);
    expect(progress.steps[0].minutes).toBe(120);
    // 5 h a week from the goal, nothing logged lately.
    const weeks = (progress.hoursTotal - progress.hoursDone) / 5;
    expect(progress.projectedOn).toBe(addDays(TODAY, Math.ceil(weeks * 7)));
  });

  it('flags a target the pace will not reach', () => {
    const progress = pathProgress(
      ai,
      {
        pathId: ai.id,
        status: 'following',
        startedOn: TODAY,
        targetOn: addDays(TODAY, 14),
      },
      [],
      [],
      [],
      5,
      TODAY,
    );
    expect(progress.behind).toBe(true);
  });

  it('splits the goal between the paths you follow, and leaves the others without a projection', () => {
    const all = pathsProgress(
      [
        {
          pathId: 'ai-coding',
          status: 'following',
          startedOn: TODAY,
          targetOn: null,
        },
        { pathId: '3d', status: 'following', startedOn: TODAY, targetOn: null },
      ],
      [],
      [],
      [],
      10,
      TODAY,
    );
    expect(all).toHaveLength(LEARNING_PATHS.length);
    const leadership = all.find((p) => p.pathId === 'leadership')!;
    expect(leadership.status).toBeNull();
    expect(leadership.projectedOn).toBeNull();
    const three = all.find((p) => p.pathId === '3d')!;
    expect(three.projectedOn).toBe(
      addDays(TODAY, Math.ceil((three.hoursTotal / 5) * 7)),
    );
  });
});

describe('reminders', () => {
  const base = {
    platforms: [] as TrainingPlatformDto[],
    certifications: [] as CertificationDto[],
    paths: [],
    daysSinceLastSession: 1,
    studying: true,
    days: STUDY_REMINDER_DEFAULTS,
    today: TODAY,
  };

  it('warns before a subscription renews, within the window from Settings', () => {
    const due = studyReminders({ ...base, platforms: [platform()] });
    expect(due).toHaveLength(1);
    expect(due[0]).toMatchObject({ kind: 'subscription', daysLeft: 9 });
    const quiet = studyReminders({
      ...base,
      platforms: [platform()],
      days: { ...STUDY_REMINDER_DEFAULTS, subscription: 5 },
    });
    expect(quiet).toHaveLength(0);
  });

  it('warns before an exam and after a missed one, and on an expiring certification', () => {
    const all = studyReminders({
      ...base,
      certifications: [
        exam(),
        exam({ id: 'c2', examOn: '2026-11-01' }),
        exam({
          id: 'c3',
          status: 'passed',
          examOn: null,
          expiresOn: '2026-12-01',
        }),
      ],
    });
    expect(all.map((r) => [r.refId, r.severity])).toEqual([
      ['c2', 'danger'],
      ['c1', 'warning'],
      ['c3', 'warning'],
    ]);
  });

  it('nudges after the idle days, only while you are studying something', () => {
    expect(
      studyReminders({ ...base, daysSinceLastSession: 8 }).map((r) => r.kind),
    ).toEqual(['idle']);
    expect(
      studyReminders({ ...base, daysSinceLastSession: 8, studying: false }),
    ).toHaveLength(0);
    expect(studyReminders({ ...base, daysSinceLastSession: 3 })).toHaveLength(
      0,
    );
  });
});
