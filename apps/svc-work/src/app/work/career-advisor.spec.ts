import { describe, expect, it } from 'vitest';
import { AI_TOOLS, aiToolDescribedV1Schema } from '@life-island/contracts';
import { describeWorkTools } from './career-advisor.js';

describe('describeWorkTools', () => {
  it('describes every Work AI tool of the registry, step by step, on the configured model', () => {
    const described = describeWorkTools(
      { feedbackModel: 'claude-opus-5-5' },
      true,
    );
    const workTools = AI_TOOLS.filter((tool) => tool.module === 'work');
    expect(described.map((d) => d.toolId)).toEqual(workTools.map((t) => t.id));
    for (const tool of workTools) {
      const description = described.find((d) => d.toolId === tool.id);
      expect(description?.steps.map((s) => s.stepId)).toEqual(
        tool.steps.map((s) => s.id),
      );
      for (const step of description?.steps ?? []) {
        expect(step.model).toBe('claude-opus-5-5');
        expect(step.system.length).toBeGreaterThan(50);
      }
      // What svc-settings will accept.
      aiToolDescribedV1Schema.parse({
        ...description,
        service: 'svc-work',
        promptVersion: null,
        describedAt: new Date().toISOString(),
      });
    }
  });
});
