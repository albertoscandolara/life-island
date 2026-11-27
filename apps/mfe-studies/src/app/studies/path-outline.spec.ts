import { LEARNING_PATHS, pathSteps } from '@life-island/contracts';
import {
  blankDraft,
  draftOutline,
  draftProblem,
  moved,
  outlineDraft,
  parseResources,
  pathDraft,
  resourceLines,
} from './path-outline';

describe('path outline drafts', () => {
  it('reads resources one per line, with the address and "(paid)"', () => {
    expect(
      parseResources(
        'Angular docs https://angular.dev\nThe Manager’s Path (paid)\n\n',
      ),
    ).toEqual([
      { label: 'Angular docs', url: 'https://angular.dev', free: true },
      { label: 'The Manager’s Path', url: null, free: false },
    ]);
  });

  it('writes resources back the way it reads them', () => {
    const resources = [
      { label: 'Course', url: 'https://example.com/c', free: false },
      { label: 'A book', url: null, free: true },
    ];
    expect(parseResources(resourceLines(resources))).toEqual(resources);
  });

  it('keeps every step id of a path through a round trip', () => {
    const path = LEARNING_PATHS[0];
    const outline = draftOutline(pathDraft(path));
    expect(outline.stages.flatMap((s) => s.steps.map((x) => x.id))).toEqual(
      pathSteps(path).map((s) => s.id),
    );
    expect(outline.name).toBe(path.name);
  });

  it('says what is missing before it can be saved', () => {
    const draft = blankDraft();
    expect(draftProblem(draft)).toBe('Give the path a name.');
    draft.name = 'Team leadership';
    expect(draftProblem(draft)).toBe(
      'Add at least one stage with a title and a step.',
    );
    draft.stages[0].title = 'The role';
    draft.stages[0].steps[0].title = 'One-on-ones';
    expect(draftProblem(draft)).toBeNull();
  });

  it('moves an item within its list, and no further', () => {
    expect(moved(['a', 'b', 'c'], 0, 1)).toEqual(['b', 'a', 'c']);
    expect(moved(['a', 'b', 'c'], 0, -1)).toEqual(['a', 'b', 'c']);
  });
});

describe('a drafted outline', () => {
  it('opens in the editor with its levels and checkpoints, as new steps', () => {
    const draft = outlineDraft({
      name: 'Rust',
      emblem: '🦀',
      topic: 'frameworks',
      stages: [
        {
          title: 'Ownership',
          level: 'foundations',
          checkpoint: 'A CLI tool',
          steps: [
            {
              title: 'The book',
              kind: 'learn',
              hours: 10,
              resources: [{ label: 'The Rust book', url: null, free: true }],
            },
          ],
        },
      ],
    });
    expect(draft.stages[0].level).toBe('foundations');
    expect(draft.stages[0].checkpoint).toBe('A CLI tool');
    expect(draft.stages[0].steps[0].id).toBeNull();
    expect(draftOutline(draft).stages[0].level).toBe('foundations');
  });
});
