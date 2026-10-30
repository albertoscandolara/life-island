import Anthropic from '@anthropic-ai/sdk';
import { buildExtractionPlan } from '../templates.js';
import { ClaudeParser, PROMPT_VERSION } from './claude-parser.js';
import {
  ContextTooLargeError,
  PermanentParseError,
  QuotaExhaustedError,
  type CategoryDefinition,
  type DiscoveryContext,
  type ParseInput,
} from './document-parser.js';

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

function apiError(status: number, message: string, type?: string) {
  return Anthropic.APIError.generate(
    status,
    { type: 'error', error: { type, message } },
    message,
    new Headers(),
  );
}

const input: ParseInput = {
  document: {
    kind: 'text',
    text: 'ENEL ENERGIA\nBolletta luce\nPeriodo 01/07/2026 - 31/08/2026\nTotale da pagare 84,20 EUR',
  },
  filename: 'enel.txt',
  title: 'Bolletta Enel',
  description: null,
};

const categories: CategoryDefinition[] = [
  {
    id: 'BILL',
    title: 'Bill',
    description: 'Utility bills',
    template: {
      fields: [
        {
          key: 'provider',
          label: 'Provider',
          type: 'string',
          description: '',
          required: true,
        },
        {
          key: 'total_amount',
          label: 'Total amount',
          type: 'amount',
          description: '',
          required: true,
        },
      ],
    },
  },
  {
    id: 'EXPENSE',
    title: 'Expense',
    description: 'Money spent',
    template: {
      fields: [
        {
          key: 'total_amount',
          label: 'Total amount',
          type: 'amount',
          description: '',
          required: true,
        },
        {
          key: 'currency',
          label: 'Currency',
          type: 'currency',
          description: '',
          required: false,
        },
      ],
    },
  },
  {
    id: 'WATER_BILL',
    title: 'Water bill',
    description: 'Water',
    template: { fields: [] },
  },
];

const classification = {
  documentType: 'electricity bill',
  purpose: 'Payment request for electricity used in July and August 2026',
  characteristics: ['recurring'],
  issuer: 'ENEL Energia',
  language: 'it',
  summary: 'An ENEL electricity bill.',
  description: 'ENEL electricity bill for July-August 2026',
  categories: [
    { id: 'BILL', evidence: 'Bolletta' },
    { id: 'EXPENSE', evidence: 'Totale da pagare' },
  ],
  targetKey: 'general.document@1',
  confidence: 0.92,
};

const generalDetails = {
  documentType: 'electricity bill',
  issuer: 'ENEL Energia',
  amount: 84.2,
  currency: 'EUR',
  summary: 'Electricity bill',
  keyFacts: [],
};

const models = {
  classify: 'classify-model',
  extract: 'extract-model',
  discover: 'discover-model',
};

describe('ClaudeParser', () => {
  it('classifies against the existing categories with the small model', async () => {
    const { client, requests } = fakeClient([
      { text: JSON.stringify(classification) },
    ]);
    const { result, runs } = await new ClaudeParser(client, models).classify(
      input,
      categories,
    );
    expect(result).toMatchObject({
      categoryIds: ['BILL', 'EXPENSE'],
      targetKey: 'general.document@1',
      category: 'other',
      flags: [],
      analysis: { documentType: 'electricity bill', issuer: 'ENEL Energia' },
    });
    expect(runs.map((run) => [run.step, run.model, run.promptVersion])).toEqual(
      [['classify', 'classify-model', PROMPT_VERSION]],
    );
    expect(requests[0].output_config?.effort).toBe('low');
    const system = JSON.stringify(requests[0].system);
    expect(system).toContain('WATER_BILL (Water bill)');
    expect(system).toContain('Never invent');
    // The category ids are listed in the output schema; the worker also drops unknown ones.
    expect(JSON.stringify(requests[0].output_config?.format)).toContain(
      'WATER_BILL',
    );
  });

  it('extracts the merged template fields once each and keeps what is missing as missing', async () => {
    const plan = buildExtractionPlan(
      categories.slice(0, 2),
      'general.document@1',
    );
    const { client, requests } = fakeClient([
      {
        text: JSON.stringify({
          details: generalDetails,
          fields: [
            {
              key: 'provider',
              status: 'found',
              value: 'ENEL Energia',
              candidates: [],
              note: null,
            },
            {
              key: 'total_amount',
              status: 'found',
              value: '84.20',
              candidates: [],
              note: null,
            },
            {
              key: 'currency',
              status: 'missing',
              value: null,
              candidates: [],
              note: null,
            },
          ],
        }),
      },
    ]);
    const { result } = await new ClaudeParser(client, models).extract(
      input,
      plan,
    );
    expect(result.details).toEqual(generalDetails);
    expect(result.fields.fields).toMatchObject({
      provider: { value: 'ENEL Energia', status: 'found' },
      total_amount: {
        value: 84.2,
        status: 'found',
        categories: ['BILL', 'EXPENSE'],
      },
      currency: { value: null, status: 'missing' },
    });
    const prompt = JSON.stringify(requests[0].messages);
    expect(prompt.match(/- total_amount/g)).toHaveLength(1);
    expect(requests[0].model).toBe('extract-model');
  });

  it('shows the model its validation errors once and flags data that stays invalid', async () => {
    const plan = buildExtractionPlan([], 'tax730.expense@1');
    const wrongYear = {
      taxYear: 2025,
      expenseType: 'medicines',
      date: '2026-03-12',
      amount: 18.9,
      issuer: 'Farmacia',
    };
    const { client, requests } = fakeClient([
      { text: JSON.stringify({ details: wrongYear, fields: [] }) },
      { text: JSON.stringify({ details: wrongYear, fields: [] }) },
    ]);
    const { result, runs } = await new ClaudeParser(client, models).extract(
      input,
      plan,
    );
    expect(runs.map((run) => run.step)).toEqual(['extract', 'correct']);
    expect(requests[1].messages.at(-1)?.content).toContain('taxYear');
    expect(result.details).toEqual(wrongYear);
    expect(result.flags).toEqual(['needs_attention']);
  });

  it('proposes new categories even when existing ones already match', async () => {
    const context: DiscoveryContext = {
      categories,
      pending: [],
      rejectedIds: ['ELETTRICITA'],
      analysis: { ...classification, categoryEvidence: [], warnings: [] },
      assignedIds: ['BILL', 'EXPENSE'],
    };
    const { client, requests } = fakeClient([
      {
        text: JSON.stringify({
          suggestions: [
            {
              id: 'ELECTRICITY_BILL',
              title: 'Electricity bill',
              description: 'Bills for electricity supply',
              reason: 'Bolletta luce',
              fields: [
                {
                  key: 'electricity_consumption',
                  label: 'Consumption',
                  type: 'number',
                  description: '',
                  required: false,
                  unit: 'kWh',
                  options: [],
                },
              ],
            },
            {
              id: 'ENEL',
              title: 'Enel',
              description: 'Documents issued by Enel',
              reason: 'Issued by ENEL Energia',
              fields: [],
            },
          ],
        }),
      },
    ]);
    const { result } = await new ClaudeParser(client, models).discover(
      input,
      context,
    );
    expect(result.suggestions.map((suggestion) => suggestion.id)).toEqual([
      'ELECTRICITY_BILL',
      'ENEL',
    ]);
    expect(result.suggestions[0].template.fields[0]).toEqual({
      key: 'electricity_consumption',
      label: 'Consumption',
      type: 'number',
      description: '',
      required: false,
      unit: 'kWh',
    });
    const prompt = JSON.stringify(requests[0]);
    expect(prompt).toContain('It already has these categories: BILL, EXPENSE');
    expect(prompt).toContain('Never propose these rejected ids: ELETTRICITA');
    expect(prompt).toContain('total_amount (amount)');
  });

  it('reports an exhausted usage quota, with the reset time the provider gives', async () => {
    const { client } = fakeClient([
      apiError(
        400,
        'You have reached your specified API usage limits. You will regain access on 2026-11-01 at 00:00 UTC.',
        'invalid_request_error',
      ),
    ]);
    const error = await new ClaudeParser(client, models)
      .classify(input, categories)
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(QuotaExhaustedError);
    expect((error as QuotaExhaustedError).resetAt?.toISOString()).toBe(
      '2026-11-01T00:00:00.000Z',
    );
    expect((error as { runs: unknown[] }).runs).toHaveLength(1);
  });

  it('splits a text too long for the context window and flags the conflicts between parts', async () => {
    const long: ParseInput = {
      ...input,
      document: {
        kind: 'text',
        text: `${'a'.repeat(50)}\n\n${'b'.repeat(50)}`,
      },
    };
    const plan = buildExtractionPlan(
      categories.slice(0, 1),
      'general.document@1',
    );
    const part = (total: string) =>
      JSON.stringify({
        details: generalDetails,
        fields: [
          {
            key: 'provider',
            status: 'found',
            value: 'ENEL Energia',
            candidates: [],
            note: null,
          },
          {
            key: 'total_amount',
            status: 'found',
            value: total,
            candidates: [],
            note: null,
          },
        ],
      });
    const { client } = fakeClient([
      apiError(
        400,
        'prompt is too long: 1200000 tokens > 1000000 maximum',
        'invalid_request_error',
      ),
      { text: part('84.20') },
      { text: part('90.00') },
    ]);
    const { result } = await new ClaudeParser(client, models, {
      chunkChars: 60,
    }).extract(long, plan);
    expect(result.flags).toContain('long_document');
    expect(result.fields.fields['provider']).toMatchObject({ status: 'found' });
    expect(result.fields.fields['total_amount']).toMatchObject({
      status: 'conflicting',
      value: null,
      candidates: ['84.20', '90.00'],
    });
  });

  it('fails a PDF that does not fit instead of splitting it', async () => {
    const { client } = fakeClient([
      apiError(413, 'Request too large', 'request_too_large'),
    ]);
    await expect(
      new ClaudeParser(client, models).classify(
        { ...input, document: { kind: 'pdf', data: Buffer.from('%PDF') } },
        categories,
      ),
    ).rejects.toBeInstanceOf(PermanentParseError);
    expect(ContextTooLargeError).toBeDefined();
  });

  it('treats a refusal as permanent', async () => {
    const { client } = fakeClient([{ stop_reason: 'refusal' }]);
    await expect(
      new ClaudeParser(client, models).classify(input, categories),
    ).rejects.toBeInstanceOf(PermanentParseError);
  });

  it('lets transient errors through so the upload is retried', async () => {
    const { client } = fakeClient([new Error('socket hang up')]);
    const promise = new ClaudeParser(client, models).classify(
      input,
      categories,
    );
    await expect(promise).rejects.toThrow('socket hang up');
    await expect(promise).rejects.not.toBeInstanceOf(PermanentParseError);
  });
});
