import { AI_TOOLS, aiToolDescribedV1Schema } from '@life-island/contracts';
import { describeClaudeParser } from './claude-parser.js';

describe('describeClaudeParser', () => {
  it('describes every document AI tool of the registry, step by step', () => {
    const described = describeClaudeParser(
      {
        classify: 'claude-haiku-5-5',
        extract: 'claude-sonnet-5-5',
        discover: 'claude-sonnet-5-5',
        reclassify: 'claude-opus-5-5',
      },
      true,
    );
    const tools = AI_TOOLS.filter((tool) => tool.module === 'documents');
    expect(described.map((d) => d.toolId).sort()).toEqual(
      tools.map((t) => t.id).sort(),
    );
    for (const tool of tools) {
      const description = described.find((d) => d.toolId === tool.id);
      expect(description?.steps.map((s) => s.stepId)).toEqual(
        tool.steps.map((s) => s.id),
      );
      aiToolDescribedV1Schema.parse({
        ...description,
        service: 'svc-parse-worker',
        describedAt: new Date().toISOString(),
      });
    }
    const reclassify = described.find(
      (d) => d.toolId === 'documents.reclassify',
    );
    expect(reclassify?.steps[0].model).toBe('claude-opus-5-5');
  });
});
