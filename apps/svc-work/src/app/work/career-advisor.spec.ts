import Anthropic from '@anthropic-ai/sdk';
import { describe, expect, it } from 'vitest';
import { AI_TOOLS, aiToolDescribedV1Schema } from '@life-island/contracts';
import { describeWorkTools, explain } from './career-advisor.js';

const config = { feedbackModel: 'claude-sonnet-5-5' };

describe('explain', () => {
  it('says what to fix instead of "try again"', () => {
    expect(
      explain(
        Anthropic.APIError.generate(
          401,
          undefined,
          'invalid x-api-key',
          new Headers(),
        ),
        config,
      ),
    ).toContain('ANTHROPIC_API_KEY');
    expect(
      explain(
        Anthropic.APIError.generate(
          404,
          undefined,
          'model not found',
          new Headers(),
        ),
        config,
      ),
    ).toContain('WORK_FEEDBACK_MODEL');
    expect(
      explain(
        Anthropic.APIError.generate(
          400,
          { error: { message: 'Your credit balance is too low' } },
          'Your credit balance is too low',
          new Headers(),
        ),
        config,
      ),
    ).toContain('credit balance');
    expect(
      explain(new SyntaxError('Unexpected end of JSON'), config),
    ).toContain('expected format');
  });
});

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
