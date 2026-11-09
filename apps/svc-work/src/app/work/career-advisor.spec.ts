import Anthropic from '@anthropic-ai/sdk';
import { describe, expect, it } from 'vitest';
import { explain } from './career-advisor.js';

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
