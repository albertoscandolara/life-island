import { dreamReach, type DreamStepsOutput } from '@life-island/contracts';
import {
  clampSteps,
  ladderFor,
  offlineQuestions,
  offlineSteps,
  stepsDossier,
} from './guide.js';
import { moneySafetyNet, monthsText } from './context.js';

const dream = {
  title: 'Change company',
  area: 'work' as const,
  story: null,
  why: null,
  today: 'Bored and underpaid',
  fears: null,
  mustKeep: 'My salary, every month',
  pace: 'gentle' as const,
  status: 'dreaming' as const,
};

describe('dreamReach', () => {
  it('starts from the pace you chose', () => {
    expect(dreamReach('gentle', []).maxStretch).toBe('tiny');
    expect(dreamReach('steady', []).maxStretch).toBe('small');
    expect(dreamReach('bolder', []).maxStretch).toBe('brave');
  });

  it('goes up only when you ask and the step felt fine, and down when you ask', () => {
    expect(
      dreamReach('steady', [{ feeling: 4, nextPace: 'bigger' }]).maxStretch,
    ).toBe('brave');
    expect(
      dreamReach('steady', [{ feeling: 2, nextPace: 'bigger' }]).maxStretch,
    ).toBe('small');
    expect(
      dreamReach('bolder', [{ feeling: 3, nextPace: 'smaller' }]).maxStretch,
    ).toBe('small');
    expect(
      dreamReach('bolder', [{ feeling: 1, nextPace: 'same' }]).maxStretch,
    ).toBe('small');
  });

  it('makes the next round tiny and short after two heavy check-ins', () => {
    const reach = dreamReach('bolder', [
      { feeling: 2, nextPace: 'same' },
      { feeling: 1, nextPace: 'same' },
    ]);
    expect(reach).toMatchObject({ maxStretch: 'tiny', count: 2, heavy: true });
  });
});

describe('offline questions', () => {
  it('asks about the area first, and not what you already wrote', () => {
    const out = offlineQuestions(dream);
    expect(out.questions[0]?.question).toMatch(/not right at work/);
    expect(
      out.questions.some((q) => /cannot put at risk/.test(q.question)),
    ).toBe(false);
    expect(out.questions.some((q) => /scares you most/.test(q.question))).toBe(
      true,
    );
    expect(out.questions.length).toBeLessThanOrEqual(5);
  });
});

describe('offline steps', () => {
  it('never offers a step beyond the reach, and every rung can be undone', () => {
    for (const area of [
      'work',
      'travel',
      'fitness',
      'learning',
      'money',
      'other',
    ] as const)
      for (const rung of ladderFor(area)) {
        expect(rung.undo.length).toBeGreaterThan(0);
        expect(rung.smaller.length).toBeGreaterThan(0);
      }
    const out = offlineSteps(dream, [], dreamReach('gentle', []), null);
    expect(out.steps).toHaveLength(3);
    expect(out.steps.every((s) => s.stretch === 'tiny')).toBe(true);
  });

  it('skips what you did, and brings back a skipped step smaller', () => {
    const [first, second] = ladderFor('work');
    const out = offlineSteps(
      dream,
      [
        { title: first!.title, status: 'done' },
        { title: second!.title, status: 'skipped' },
      ],
      dreamReach('gentle', []),
      null,
    );
    expect(out.steps[0]?.title).toBe(second!.smaller);
    expect(out.steps.map((s) => s.title)).not.toContain(first!.title);
    expect(out.steps.map((s) => s.title)).not.toContain(second!.title);
  });

  it('keeps resigning for later, with your safety net', () => {
    const out = offlineSteps(dream, [], dreamReach('gentle', []), {
      runwayMonths: 4.5,
    });
    expect(out.notYet[0]?.move).toBe('Resigning');
    expect(out.notYet[0]?.when).toContain('4.5 months');
  });
});

describe('what Claude reads and writes', () => {
  it('names the reach and the shared facts, and leaves out unanswered questions', () => {
    const text = stepsDossier(
      '2026-11-14',
      dream,
      [
        {
          id: 'q1',
          dreamId: 'd',
          question: 'What is wrong?',
          why: null,
          answer: 'Growth',
          source: 'offline',
          createdAt: '',
        },
        {
          id: 'q2',
          dreamId: 'd',
          question: 'Unanswered?',
          why: null,
          answer: null,
          source: 'offline',
          createdAt: '',
        },
      ],
      [],
      [],
      dreamReach('gentle', []),
      {
        areas: [
          {
            area: 'money',
            name: 'Money',
            emblem: '',
            reachable: true,
            error: null,
            facts: [{ label: 'Safety net', value: '5 months' }],
          },
          {
            area: 'work',
            name: 'Work',
            emblem: '',
            reachable: false,
            error: 'Not running',
            facts: [],
          },
        ],
        safetyNet: null,
      },
      'Only weekends',
    );
    expect(text).toContain('A: Growth');
    expect(text).not.toContain('Unanswered?');
    expect(text).toContain('- Safety net: 5 months');
    expect(text).not.toContain('Work:');
    expect(text).toContain('Furthest stretch allowed now: tiny');
    expect(text).toContain('They add: Only weekends');
  });

  it('pulls a step that reaches too far back within the reach', () => {
    const output: DreamStepsOutput = {
      reflection: 'r',
      steps: [
        {
          title: 'Apply',
          kind: 'try',
          why: '',
          minutes: 60.4,
          costEuro: -3,
          cost: '',
          stretch: 'brave',
          undo: 'u',
          smaller: 's',
        },
      ],
      notYet: [],
      care: null,
    };
    const [step] = clampSteps(output, dreamReach('gentle', [])).steps;
    expect(step).toMatchObject({ stretch: 'tiny', minutes: 60, costEuro: 0 });
  });
});

describe('safety net', () => {
  it('divides the balance by a usual month, from full months only', () => {
    const net = moneySafetyNet(
      {
        accounts: [{}],
        totals: { balance: 9000, savingsRate: 0.2 },
        months: [
          { month: '2026-08', spending: 2000 },
          { month: '2026-09', spending: 1800 },
          { month: '2026-10', spending: 2200 },
          { month: '2026-11', spending: 300 },
        ],
      } as never,
      '2026-11-14',
    );
    expect(net).toMatchObject({ monthlySpending: 2000, runwayMonths: 4.5 });
  });

  it('writes months as years and months', () => {
    expect(monthsText(38)).toBe('3 years and 2 months');
    expect(monthsText(1)).toBe('1 month');
  });
});
