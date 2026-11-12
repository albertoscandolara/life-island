import {
  LEARNING_PATHS,
  stagesToScan,
  type ScoutOutput,
} from '@life-island/contracts';
import {
  planScan,
  sameUrl,
  scoutRequest,
  type KnownResource,
  type ScanScope,
} from './scout.js';

const ai = LEARNING_PATHS.find((p) => p.id === 'ai-coding')!;
const stages = stagesToScan(ai, new Set());
const [first, second] = stages[0].steps;

const scope = (known: KnownResource[] = []): ScanScope => ({
  path: ai,
  stages,
  known,
  today: '2026-11-12',
});

const resource = (url: string, title = 'A resource') => ({
  title,
  url,
  kind: 'docs' as const,
  publishedOn: '2026-09',
  free: true,
  why: 'Current and official.',
});

const output = (over: Partial<ScoutOutput> = {}): ScoutOutput => ({
  steps: [],
  pinned: [],
  outline: [],
  ...over,
});

describe('the scout request', () => {
  it('lists the stages to scan with their steps, pinned and dismissed resources', () => {
    const text = scoutRequest(
      scope([
        {
          id: '1',
          stepId: first.id,
          url: 'https://pinned.dev/a',
          title: 'Pinned one',
          status: 'pinned',
        },
        {
          id: '2',
          stepId: first.id,
          url: 'https://gone.dev/b',
          title: 'Gone',
          status: 'dismissed',
        },
      ]),
    );
    expect(text).toContain('Today: 2026-11-12');
    expect(text).toContain(`Step ${first.id}`);
    expect(text).toContain(`stage id: ${stages[0].id}`);
    expect(text).toContain('Pinned: Pinned one <https://pinned.dev/a>');
    expect(text).toContain('# Dismissed (never suggest)\nhttps://gone.dev/b');
    expect(text).toContain('# The other stages of the path');
  });
});

describe('a scan', () => {
  it('scans the stage with your next step and the one after', () => {
    const done = new Set(ai.stages[0].steps.map((s) => s.id));
    expect(stagesToScan(ai, done).map((s) => s.id)).toEqual([
      ai.stages[1].id,
      ai.stages[2].id,
    ]);
  });

  it('never suggests a dismissed, pinned or hand-picked address, nor one outside the scope', () => {
    const handPicked = first.resources.find((r) => r.url)!.url!;
    const plan = planScan(
      scope([
        {
          id: '1',
          stepId: first.id,
          url: 'https://pinned.dev/a',
          title: 'P',
          status: 'pinned',
        },
        {
          id: '2',
          stepId: first.id,
          url: 'https://gone.dev/b',
          title: 'D',
          status: 'dismissed',
        },
      ]),
      output({
        steps: [
          {
            stepId: first.id,
            pace: 'fast',
            resources: [
              resource('https://pinned.dev/a/'),
              resource('https://GONE.dev/b#intro'),
              resource(handPicked),
              resource('javascript:alert(1)'),
              resource('https://new.dev/guide', 'New guide'),
              resource('https://new.dev/guide'),
            ],
          },
          {
            stepId: 'someone-else.step',
            pace: 'fast',
            resources: [resource('https://x.dev')],
          },
        ],
      }),
      [],
    );
    expect(plan.suggestions.map((r) => r.url)).toEqual([
      'https://new.dev/guide',
    ]);
    expect(plan.paces).toEqual([{ stepId: first.id, pace: 'fast' }]);
    expect(plan.stepIds).toContain(second.id);
  });

  it('keeps at most four suggestions a step and drops a malformed date', () => {
    const plan = planScan(
      scope(),
      output({
        steps: [
          {
            stepId: first.id,
            pace: 'evergreen',
            resources: [1, 2, 3, 4, 5].map((n) => ({
              ...resource(`https://site.dev/${n}`),
              publishedOn: n === 1 ? 'last spring' : '2025-01-31',
            })),
          },
        ],
      }),
      [],
    );
    expect(plan.suggestions).toHaveLength(4);
    expect(plan.suggestions[0].publishedOn).toBeNull();
    expect(plan.suggestions[1].publishedOn).toBe('2025-01-31');
  });

  it('flags an outdated pinned resource and clears a current one', () => {
    const plan = planScan(
      scope([
        {
          id: 'old',
          stepId: first.id,
          url: 'https://old.dev',
          title: 'Old',
          status: 'pinned',
        },
        {
          id: 'fine',
          stepId: first.id,
          url: 'https://fine.dev',
          title: 'Fine',
          status: 'pinned',
        },
      ]),
      output({
        pinned: [
          {
            url: 'https://old.dev/',
            outdated: true,
            reason: 'Covers version 2; 4 is current.',
          },
          { url: 'https://fine.dev', outdated: false, reason: null },
        ],
      }),
      [],
    );
    expect(plan.checks).toEqual([
      { id: 'old', outdated: 'Covers version 2; 4 is current.' },
      { id: 'fine', outdated: null },
    ]);
  });

  it('proposes at most two outline changes, never one proposed before', () => {
    const stage = stages[0].id;
    const add = (title: string) => ({
      kind: 'add-step' as const,
      stageId: stage,
      stepId: null,
      title,
      detail: 'What it is.',
      outcome: 'You can do it.',
      stepKind: 'learn' as const,
      hours: 3.4,
      reason: 'The field moved.',
    });
    const plan = planScan(
      scope(),
      output({
        outline: [
          add('Context engineering'),
          add('Already declined'),
          { ...add(''), kind: 'retire-step', stepId: 'not.in.scope' },
          { ...add(''), kind: 'retire-step', stepId: second.id },
          add('A third one'),
        ],
      }),
      [{ kind: 'add-step', stepId: 'x', title: 'Already declined' }],
    );
    expect(plan.changes).toHaveLength(2);
    expect(plan.changes[0]).toMatchObject({
      kind: 'add-step',
      stepId: `ai-coding.${stage}.scout-context-engineering`,
      hours: 3,
    });
    expect(plan.changes[1]).toMatchObject({
      kind: 'retire-step',
      stepId: second.id,
    });
  });

  it('compares addresses without the fragment, trailing slash or host case', () => {
    expect(sameUrl('https://Docs.Dev/a/#top')).toBe(
      sameUrl('https://docs.dev/a'),
    );
  });
});
