import Anthropic from '@anthropic-ai/sdk';
import { describe, expect, it } from 'vitest';
import {
  AiAnswerError,
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
