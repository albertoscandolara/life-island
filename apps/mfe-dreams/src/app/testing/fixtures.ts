import type {
  DreamCheckInDto,
  DreamDto,
  DreamMilestoneDto,
  DreamsOverviewDto,
  DreamStepDto,
} from '@life-island/contracts';

/* Small builders for the specs: each fills what a test does not care about. */

export function aStep(over: Partial<DreamStepDto> = {}): DreamStepDto {
  return {
    id: 's1',
    createdAt: '2026-11-01T00:00:00.000Z',
    dreamId: 'd1',
    title: 'Write down what is wrong at work',
    kind: 'reflect',
    why: 'Clear words make the next step obvious.',
    minutes: 20,
    costEuro: 0,
    cost: null,
    stretch: 'tiny',
    undo: 'Delete the note',
    smaller: 'Write one line',
    status: 'chosen',
    dueDate: null,
    doneOn: null,
    milestoneId: 'm1',
    cue: 'After breakfast',
    ifThen: 'If I notice I am putting it off, then I write one line.',
    expectedHard: null,
    source: 'offline',
    awaitingCheckIn: false,
    ...over,
  };
}

export function aMilestone(
  over: Partial<DreamMilestoneDto> = {},
): DreamMilestoneDto {
  return {
    id: 'm1',
    createdAt: '2026-11-01T00:00:00.000Z',
    dreamId: 'd1',
    title: 'Clear on what I want, and why',
    why: null,
    position: 0,
    reachedOn: null,
    source: 'offline',
    current: true,
    doneSteps: 0,
    openSteps: 1,
    ...over,
  };
}

export function aCheckIn(over: Partial<DreamCheckInDto> = {}): DreamCheckInDto {
  return {
    id: 'c1',
    createdAt: '2026-11-10T10:00:00.000Z',
    dreamId: 'd1',
    stepId: 's0',
    outcome: 'done',
    feeling: 4,
    note: null,
    nextPace: 'same',
    actualHard: null,
    learned: null,
    stepTitle: 'A step',
    expectedHard: null,
    ...over,
  };
}

export function aDream(over: Partial<DreamDto> = {}): DreamDto {
  const steps = over.steps ?? [aStep()];
  return {
    id: 'd1',
    createdAt: '2026-11-01T00:00:00.000Z',
    title: 'Change company',
    area: 'work',
    story: null,
    why: null,
    today: null,
    fears: null,
    mustKeep: null,
    measure: null,
    targetDate: null,
    pace: 'steady',
    status: 'moving',
    contextAreas: [],
    opening: null,
    questions: [],
    milestones: [aMilestone()],
    checkIns: [],
    guidance: null,
    nextStep: steps.find((s) => s.status === 'chosen') ?? null,
    doneSteps: steps.filter((s) => s.status === 'done').length,
    unansweredQuestions: 0,
    reach: { maxStretch: 'small', count: 3, reason: '', heavy: false },
    idleDays: 3,
    stuck: false,
    daysLeft: null,
    ...over,
    steps,
  };
}

export function anOverview(
  over: Partial<DreamsOverviewDto> = {},
): DreamsOverviewDto {
  return {
    today: '2026-11-14',
    weekStart: '2026-11-09',
    dreams: [],
    habits: [],
    reviews: [],
    reviewedThisWeek: false,
    aiQuestions: false,
    aiSteps: false,
    ...over,
  };
}
