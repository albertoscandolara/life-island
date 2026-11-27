import { describePathBuilder } from './path-builder.js';
import { builderOutline, builderRequest, seenUrls } from './builder.js';

const output = {
  name: 'Rust for web services',
  emblem: '🦀',
  topic: 'frameworks' as const,
  summary: 'From ownership to a service in production.',
  why: 'Fast, safe back ends.',
  capstone: 'A small API in Rust.',
  certifications: [],
  stages: [
    {
      title: 'Ownership',
      goal: 'Read and write safe Rust.',
      level: 'foundations' as const,
      checkpoint:
        'A CLI tool of yours that compiles with no clone() you cannot explain.',
      steps: [
        {
          title: 'The Rust book, chapters 1 to 10',
          kind: 'learn' as const,
          hours: 11.3,
          detail: 'Ownership, borrowing, traits.',
          outcome: 'You can fix a borrow checker error.',
          resources: [
            {
              label: 'The Rust book',
              url: 'https://doc.rust-lang.org/book/',
              free: true,
            },
            {
              label: 'Made up',
              url: 'https://example.com/never-seen',
              free: true,
            },
          ],
        },
      ],
    },
    {
      title: 'Empty',
      goal: '',
      level: 'working' as const,
      checkpoint: '',
      steps: [],
    },
  ],
};

describe('path builder', () => {
  it('writes the request from your topic, start and goal', () => {
    const text = builderRequest(
      { subject: 'Rust', start: 'new', goal: 'ship an API', hoursPerWeek: 4 },
      '2026-11-27',
    );
    expect(text).toContain('Topic: Rust');
    expect(text).toContain('Where I start: New to it');
    expect(text).toContain('Where I want to get: ship an API');
    expect(text).toContain('about 4 hours a week');
  });

  it('keeps only addresses the search saw, and drops empty stages', () => {
    const notes = 'Found the book at https://doc.rust-lang.org/book. Good.';
    expect(seenUrls(notes).has('https://doc.rust-lang.org/book')).toBe(true);
    const outline = builderOutline(output, notes);
    expect(outline.stages).toHaveLength(1);
    const [stage] = outline.stages;
    expect(stage.level).toBe('foundations');
    expect(stage.checkpoint).toContain('CLI tool');
    expect(stage.steps[0].hours).toBe(11.5);
    expect(stage.steps[0].resources?.map((r) => r.url)).toEqual([
      'https://doc.rust-lang.org/book/',
      null,
    ]);
  });

  it('describes its two requests for Settings', () => {
    const [tool] = describePathBuilder(
      { coachModel: 'claude-sonnet-5-5' },
      true,
    );
    expect(tool.toolId).toBe('studies.path-builder');
    expect(tool.steps.map((s) => s.stepId)).toEqual(['research', 'format']);
  });
});
