import Anthropic from '@anthropic-ai/sdk';
import { ClaudeParser, PROMPT_VERSION } from './claude-parser.js';
import { PermanentParseError, type ParseInput } from './document-parser.js';

type Reply = { text?: string; stop_reason?: string } | Error;

/** A stand-in for the SDK client that replays canned replies and records requests. */
function fakeClient(replies: Reply[]) {
  const requests: Anthropic.Beta.MessageCreateParamsNonStreaming[] = [];
  const create = async (
    request: Anthropic.Beta.MessageCreateParamsNonStreaming,
  ) => {
    requests.push(JSON.parse(JSON.stringify(request)));
    const reply = replies.shift();
    if (!reply) throw new Error('No more replies');
    if (reply instanceof Error) throw reply;
    return {
      content:
        reply.text === undefined ? [] : [{ type: 'text', text: reply.text }],
      stop_reason: reply.stop_reason ?? 'end_turn',
      usage: { input_tokens: 100, output_tokens: 20 },
    };
  };
  const client = { beta: { messages: { create } } } as unknown as Anthropic;
  return { client, requests };
}

const input: ParseInput = {
  document: {
    kind: 'text',
    text: 'FARMACIA CENTRALE\n12/03/2026\nTOTALE 18,90 EUR\nPagamento bancomat',
  },
  filename: 'farmacia.txt',
  title: 'Farmacia',
  description: null,
};

const classification = (confidence = 0.95) =>
  JSON.stringify({
    targetKey: 'tax730.expense@1',
    description: 'Pharmacy receipt',
    language: 'it',
    confidence,
  });

const validExpense = {
  taxYear: 2026,
  expenseType: 'medicines',
  frame730: 'E1',
  date: '2026-03-12',
  amount: 18.9,
  traceablePayment: true,
  issuer: 'Farmacia Centrale',
};

const models = { classify: 'classify-model', extract: 'extract-model' };

describe('ClaudeParser', () => {
  it('classifies with the small model, then extracts with the target schema', async () => {
    const { client, requests } = fakeClient([
      { text: classification() },
      { text: JSON.stringify(validExpense) },
    ]);
    const result = await new ClaudeParser(client, models).parse(input);

    expect(result).toMatchObject({
      targetKey: 'tax730.expense@1',
      category: 'tax730',
      description: 'Pharmacy receipt',
      details: validExpense,
      confidence: 0.95,
      flags: [],
    });
    expect(
      result.runs.map((run) => [run.step, run.model, run.promptVersion]),
    ).toEqual([
      ['classify', 'classify-model', PROMPT_VERSION],
      ['extract', 'extract-model', PROMPT_VERSION],
    ]);
    expect(requests[0].output_config?.effort).toBe('low');
    expect(requests[1].output_config?.format?.type).toBe('json_schema');
    expect(JSON.stringify(requests[1].messages)).toContain('tax730.expense@1');
  });

  it('shows the model its validation errors once, and keeps the corrected data', async () => {
    const wrongYear = { ...validExpense, taxYear: 2025 };
    const { client, requests } = fakeClient([
      { text: classification() },
      { text: JSON.stringify(wrongYear) },
      { text: JSON.stringify(validExpense) },
    ]);
    const result = await new ClaudeParser(client, models).parse(input);

    expect(result.details).toEqual(validExpense);
    expect(result.flags).toEqual([]);
    expect(result.runs.map((run) => run.step)).toEqual([
      'classify',
      'extract',
      'correct',
    ]);
    const correction = requests[2].messages.at(-1);
    expect(correction?.content).toContain('taxYear');
  });

  it('flags data that is still invalid and low confidence instead of dropping it', async () => {
    const wrongYear = { ...validExpense, taxYear: 2025 };
    const { client } = fakeClient([
      { text: classification(0.4) },
      { text: JSON.stringify(wrongYear) },
      { text: JSON.stringify(wrongYear) },
    ]);
    const result = await new ClaudeParser(client, models).parse(input);
    expect(result.details).toEqual(wrongYear);
    expect(result.flags).toEqual(['low_confidence', 'needs_attention']);
  });

  it('treats a refusal as permanent', async () => {
    const { client } = fakeClient([{ stop_reason: 'refusal' }]);
    await expect(
      new ClaudeParser(client, models).parse(input),
    ).rejects.toBeInstanceOf(PermanentParseError);
  });

  it('lets transient errors through so the upload is retried', async () => {
    const { client } = fakeClient([new Error('socket hang up')]);
    const promise = new ClaudeParser(client, models).parse(input);
    await expect(promise).rejects.toThrow('socket hang up');
    await expect(promise).rejects.not.toBeInstanceOf(PermanentParseError);
  });
});
