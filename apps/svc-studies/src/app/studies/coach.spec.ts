import { LEARNING_PATHS, type CertificationDto } from '@life-island/contracts';
import { coachDossier, offlinePlan, type CoachInput } from './coach.js';
import { pathsProgress, studyStats } from './progress.js';
import { describeStudiesTools } from './study-coach.js';

const TODAY = '2026-11-11';
const ai = LEARNING_PATHS.find((p) => p.id === 'ai-coding')!;
const doing = ai.stages[0].steps[0];

function input(extra: Partial<CoachInput> = {}): CoachInput {
  const paths = pathsProgress(
    [
      {
        pathId: 'ai-coding',
        status: 'following',
        startedOn: TODAY,
        targetOn: null,
      },
      {
        pathId: 'leadership',
        status: 'paused',
        startedOn: TODAY,
        targetOn: null,
      },
    ],
    [
      {
        stepId: doing.id,
        status: 'doing',
        startedOn: '2026-11-02',
        doneOn: null,
        notes: null,
      },
    ],
    [],
    [{ pathId: 'ai-coding', stepId: doing.id, minutes: 60 }],
    5,
    TODAY,
  );
  const stats = studyStats({
    sessions: [],
    courses: [],
    certifications: [],
    platforms: [],
    paths,
    weeklyGoalHours: 5,
    totalMinutes: 60,
    lastSessionOn: '2026-11-02',
    subscriptionSpendThisYear: 0,
    today: TODAY,
  });
  return {
    paths,
    courses: [],
    certifications: [],
    stats,
    reminders: [],
    hours: null,
    today: TODAY,
    ...extra,
  };
}

describe('offline study plan', () => {
  it('finishes the step in progress first, then starts the next one, within the goal', () => {
    const plan = offlinePlan(input(), null);
    expect(plan.focus[0].stepId).toBe(doing.id);
    expect(plan.focus[0].title).toContain(doing.title);
    expect(plan.focus[1].stepId).toBe(ai.stages[0].steps[1].id);
    const hours = plan.focus.reduce((sum, f) => sum + f.hours, 0);
    expect(hours).toBeLessThanOrEqual(5);
    const minutes = plan.schedule.reduce((sum, s) => sum + s.minutes, 0);
    expect(minutes).toBeLessThanOrEqual(5 * 60 + 10);
    expect(plan.schedule.length).toBeGreaterThan(0);
  });

  it('puts an exam within a month first', () => {
    const exam: CertificationDto = {
      id: 'c1',
      name: 'KCNA',
      provider: null,
      topic: 'infrastructure',
      status: 'booked',
      examOn: '2026-11-30',
      cost: null,
      obtainedOn: null,
      expiresOn: null,
      credentialUrl: null,
      notes: null,
      createdAt: TODAY,
    };
    const plan = offlinePlan(input({ certifications: [exam] }), null);
    expect(plan.focus[0].title).toBe('Prepare KCNA');
    expect(plan.focus[0].hours).toBe(2.5);
  });

  it('says it cannot answer a question without AI, and uses the hours you have', () => {
    const plan = offlinePlan(input({ hours: 2 }), 'What first?');
    expect(plan.summary).toContain('Settings → AI tools');
    expect(plan.focus.reduce((sum, f) => sum + f.hours, 0)).toBeLessThanOrEqual(
      2,
    );
  });

  it('suggests picking a path when you follow none', () => {
    const plan = offlinePlan(input({ paths: [] }), null);
    expect(plan.focus).toHaveLength(0);
    expect(plan.tips[0]).toContain('Pick one path');
  });
});

describe('coach dossier', () => {
  it('lists the steps not done of the paths you follow, by id, and nothing personal', () => {
    const dossier = coachDossier(input());
    expect(dossier).toContain(`[studying] ${doing.id}`);
    expect(dossier).toContain('Paused paths: Becoming a team leader');
    expect(dossier).toContain('Weekly goal: 5 h');
    expect(dossier).not.toContain('@');
  });
});

describe('describeStudiesTools', () => {
  it('describes the coach request as it is sent', () => {
    const [tool] = describeStudiesTools(
      { coachModel: 'claude-sonnet-5-5' },
      true,
    );
    expect(tool.toolId).toBe('studies.study-coach');
    expect(tool.steps[0].stepId).toBe('plan');
    expect(tool.steps[0].maxTokens).toBe(8000);
  });
});
