import Anthropic from '@anthropic-ai/sdk';
import { AiSpendDenied } from '@life-island/be-common';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import {
  AiAnswerError,
  AiAssistant,
  describeAiSteps,
  explainAiError,
  type AiAssistantStep,
} from './ai-assistant.js';

const error = (status: number, message: string) =>
  Anthropic.APIError.generate(
    status,
    { error: { message } },
    message,
    new Headers(),
  );

describe('explainAiError', () => {
  it('says what to fix instead of "try again"', () => {
    const explain = (e: unknown) => explainAiError(e, 'claude-x', 'svc-work');
    expect(explain(error(401, 'invalid x-api-key'))).toContain(
      'ANTHROPIC_API_KEY',
    );
    expect(explain(error(404, 'model not found'))).toContain('claude-x');
    expect(explain(error(400, 'Your credit balance is too low'))).toContain(
      'credit balance',
    );
    expect(explain(new SyntaxError('Unexpected end of JSON'))).toContain(
      'expected format',
    );
    expect(explain(new AiAnswerError('Cut short.'))).toBe('Cut short.');
  });
});

describe('describeAiSteps', () => {
  it('describes a web search step without caching and a structured one with it', () => {
    const steps: AiAssistantStep[] = [
      {
        stepId: 'research',
        label: 'Search the web',
        system: 'Search.',
        userTemplate: '{q}',
        outputFormat: null,
        effort: 'medium',
        maxTokens: 16000,
        tools: ['web_search (up to 8 searches)'],
      },
      {
        stepId: 'format',
        label: 'Structure',
        system: 'Format.',
        userTemplate: '{notes}',
        outputFormat: 'out',
        effort: 'low',
        maxTokens: 8000,
      },
    ];
    const described = describeAiSteps('work.market-check', true, 'm', steps);
    expect(
      described.steps.map((s) => [s.stepId, s.model, s.promptCaching]),
    ).toEqual([
      ['research', 'm', false],
      ['format', 'm', true],
    ]);
    expect(described.steps[0].outputFormat).toBeNull();
    expect(described.steps[1].outputFormat).toBe('out (structured output)');
    expect(described.steps[0].tools).toEqual(['web_search (up to 8 searches)']);
  });
});

describe('AiAssistant spending guard', () => {
  it('refuses with a 429 in words before calling the model', async () => {
    const reserve = vi.fn(async () => {
      throw new AiSpendDenied('You reached today’s AI allowance.');
    });
    const svc = {
      pool: { query: vi.fn(async () => ({ rows: [] })) },
      schema: 'money',
    };
    const assistant = new AiAssistant({
      toolId: 'money.review',
      service: 'svc-money',
      apiKey: 'sk-test',
      defaultModel: 'claude-sonnet-5-5',
      svc: svc as never,
      guard: { reserve, settle: vi.fn() },
    });
    const error = await assistant
      .ask({
        step: {
          stepId: 'review',
          label: 'Review',
          system: 'Review the month.',
          userTemplate: '{totals}',
          outputFormat: 'review',
          effort: 'low',
          maxTokens: 4000,
        },
        user: 'Totals: 100',
        output: z.object({ ok: z.boolean() }),
      })
      .catch((e: unknown) => e);
    expect((error as { getStatus(): number }).getStatus()).toBe(429);
    expect((error as Error).message).toContain('allowance');
    expect(reserve).toHaveBeenCalledWith(
      expect.objectContaining({ toolId: 'money.review', userId: null }),
    );
  });
});
