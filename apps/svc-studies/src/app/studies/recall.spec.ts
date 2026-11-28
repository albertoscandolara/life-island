import {
  LEARNING_PATHS,
  nextRecall,
  pathStep,
  type StudiesOverviewDto,
} from '@life-island/contracts';
import { studyAttentionItems } from './attention.js';
import { describeRecallTools } from './recall-coach.js';
import {
  findStep,
  firstDue,
  offlineCard,
  recallStatus,
  stepMaterial,
} from './recall.js';
import type { RecallCardRow } from '../db/schema.js';

const card = (over: Partial<RecallCardRow>): RecallCardRow => ({
  id: 'c',
  stepId: 'ai-coding.agents.mcp',
  pathId: 'ai-coding',
  question: 'Why?',
  answer: 'Because.',
  round: 0,
  dueOn: '2026-11-28',
  lastResult: null,
  ai: true,
  createdAt: new Date('2026-11-27T10:00:00Z'),
  ...over,
});

describe('recall', () => {
  it('comes back after a day, a week and a month, and starts again when missed', () => {
    expect(firstDue('2026-11-28')).toBe('2026-11-29');
    expect(nextRecall(0, 'got', '2026-11-29')).toEqual({
      round: 1,
      dueOn: '2026-12-06',
    });
    expect(nextRecall(1, 'got', '2026-12-06')).toEqual({
      round: 2,
      dueOn: '2027-01-05',
    });
    expect(nextRecall(2, 'got', '2027-01-05')).toBeNull();
    expect(nextRecall(2, 'missed', '2027-01-05')).toEqual({
      round: 0,
      dueOn: '2027-01-06',
    });
  });

  it('shows what is due, oldest first, and when the next one comes', () => {
    const status = recallStatus({
      cards: [
        card({ id: 'b', dueOn: '2026-11-28' }),
        card({ id: 'a', dueOn: '2026-11-20' }),
        card({ id: 'later', dueOn: '2026-12-10' }),
      ],
      learned: 2,
      ai: true,
      today: '2026-11-28',
    });
    expect(status.due.map((c) => c.id)).toEqual(['a', 'b']);
    expect(status).toMatchObject({ upcoming: 1, nextOn: null, learned: 2 });
    expect(
      recallStatus({
        cards: [card({ dueOn: '2026-12-10' })],
        learned: 0,
        ai: false,
        today: '2026-11-28',
      }).nextOn,
    ).toBe('2026-12-10');
  });

  it('writes one question from the outcome when the quiz is off', () => {
    const step = pathStep('ai-coding.agents.mcp')!;
    const q = offlineCard(step);
    expect(q.question).toMatch(/^Model Context Protocol: in your own words, /);
    expect(q.question.endsWith('?')).toBe(true);
    expect(q.answer).toBe(step.detail);
  });

  it('gives the model the step with its stage and outcome', () => {
    const found = findStep('ai-coding.agents.mcp', LEARNING_PATHS)!;
    const text = stepMaterial(found.path, found.stage, found.step);
    expect(text).toContain('Step: Model Context Protocol (Build)');
    expect(text).toContain('What you can do after it:');
    expect(findStep('nope', LEARNING_PATHS)).toBeNull();
  });

  it('asks you to answer in Needs you when questions are due', () => {
    const overview = {
      catalogue: [...LEARNING_PATHS],
      paths: [],
      reminders: [],
      scout: { resources: [], proposals: [] },
      recall: recallStatus({
        cards: [card({}), card({ id: 'd' })],
        learned: 0,
        ai: true,
        today: '2026-11-28',
      }),
    } as unknown as StudiesOverviewDto;
    expect(studyAttentionItems(overview)).toEqual([
      expect.objectContaining({
        id: 'recall',
        title: 'Answer 2 recall questions',
        path: '/studies#studies-recall',
        action: 'Answer',
      }),
    ]);
  });

  it('describes both tools to Settings', () => {
    const [quiz, teach] = describeRecallTools(
      { coachModel: 'claude-sonnet-5-5' },
      true,
      false,
    );
    expect(quiz.toolId).toBe('studies.recall-quiz');
    expect(teach.toolId).toBe('studies.teach-back');
  });
});
