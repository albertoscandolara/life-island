import { LEARNING_PATHS, pathSteps } from '@life-island/contracts';
import { outlinePath, pathTemplates, yourCatalogue } from './paths.js';

const outline = {
  name: 'Team leadership',
  emblem: '🧭',
  topic: 'leadership' as const,
  stages: [
    {
      title: 'The role',
      steps: [
        { title: 'One-on-ones', kind: 'learn' as const, hours: 2 },
        { title: 'One-on-ones', kind: 'practice' as const, hours: 3 },
      ],
    },
  ],
};

describe('outlinePath', () => {
  it('gives new stages and steps ids from their titles, unique in the path', () => {
    const path = outlinePath('team-leadership', outline);
    expect(path.stages[0].id).toBe('the-role');
    expect(path.stages[0].steps.map((s) => s.id)).toEqual([
      'team-leadership.the-role.one-on-ones',
      'team-leadership.the-role.one-on-ones-2',
    ]);
  });

  it('keeps the id of a step of this path, so its progress stays', () => {
    const path = outlinePath('team-leadership', {
      ...outline,
      stages: [
        {
          id: 'the-role',
          title: 'The role, renamed',
          steps: [
            {
              id: 'team-leadership.the-role.old',
              title: 'Renamed',
              kind: 'learn',
              hours: 1,
            },
            {
              id: 'ai-coding.foundations.llm-basics',
              title: 'Borrowed',
              kind: 'learn',
              hours: 1,
            },
          ],
        },
      ],
    });
    expect(path.stages[0].id).toBe('the-role');
    expect(path.stages[0].steps.map((s) => s.id)).toEqual([
      'team-leadership.the-role.old',
      'team-leadership.the-role.borrowed',
    ]);
  });
});

describe('yourCatalogue', () => {
  const mine = {
    ...outlinePath('team-leadership', outline),
    updatedAt: new Date('2026-06-01T00:00:00Z'),
  };

  it('holds the templates you added and the paths you wrote, templates first', () => {
    const catalogue = yourCatalogue({
      stored: [mine],
      yours: new Set(['finance', 'team-leadership']),
      changes: [],
    });
    expect(catalogue.map((p) => p.id)).toEqual(['finance', 'team-leadership']);
  });

  it('reads a template you changed from your row', () => {
    const finance = { ...mine, id: 'finance', name: 'My money' };
    const [path] = yourCatalogue({
      stored: [finance],
      yours: new Set(['finance']),
      changes: [],
    });
    expect(path.name).toBe('My money');
    expect(path.level).toBe('beginner');
  });

  it('applies a scout change only if accepted after your last edit', () => {
    const change = (decidedAt: string, stepId: string) => ({
      pathId: 'team-leadership',
      kind: 'add-step' as const,
      stageId: 'the-role',
      stepId,
      title: 'New',
      detail: null,
      outcome: null,
      stepKind: 'learn' as const,
      hours: 1,
      decidedAt: new Date(decidedAt),
    });
    const [path] = yourCatalogue({
      stored: [mine],
      yours: new Set(),
      changes: [
        change('2026-05-01T00:00:00Z', 'team-leadership.the-role.before'),
        change('2026-07-01T00:00:00Z', 'team-leadership.the-role.after'),
      ],
    });
    expect(pathSteps(path).map((s) => s.id)).toContain(
      'team-leadership.the-role.after',
    );
    expect(pathSteps(path).map((s) => s.id)).not.toContain(
      'team-leadership.the-role.before',
    );
  });
});

describe('pathTemplates', () => {
  it('offers the curated paths you have not added', () => {
    const templates = pathTemplates([LEARNING_PATHS[0]]);
    expect(templates.map((t) => t.id)).not.toContain(LEARNING_PATHS[0].id);
    expect(templates).toHaveLength(LEARNING_PATHS.length - 1);
    expect(templates[0].steps).toBeGreaterThan(0);
  });
});
