import Anthropic from '@anthropic-ai/sdk';
import { RateLimitedError, StepInterruptedError } from './document-parser.js';
import { MessageBatcher } from './message-batcher.js';
import { classifyProviderError } from './provider-errors.js';

type Request = Anthropic.Beta.MessageCreateParamsNonStreaming;
type Result = Anthropic.Beta.Messages.BetaMessageBatchResult;

const FAST = { pollMs: 1, collectMs: 5, maxCollectMs: 50, maxRequests: 100 };

function message(text: string, stop_reason = 'end_turn') {
  return {
    content: [{ type: 'text', text }],
    stop_reason,
    usage: { input_tokens: 10, output_tokens: 5 },
  } as unknown as Anthropic.Beta.BetaMessage;
}

function request(text: string, extra: object = {}): Request {
  return {
    model: 'model',
    max_tokens: 100,
    messages: [{ role: 'user', content: text }],
    ...extra,
  } as Request;
}

/**
 * A batches API whose batches end on the second poll; `answer` decides the
 * result of each request from its params.
 */
function fakeBatches(answer: (params: Request) => Result) {
  const created: { custom_id: string; params: Request }[][] = [];
  const cancelled: string[] = [];
  const polls = new Map<string, number>();
  let failCreate: Error | undefined;
  const batches = {
    create: async (body: {
      requests: { custom_id: string; params: Request }[];
    }) => {
      if (failCreate) throw failCreate;
      created.push(body.requests);
      return { id: `batch${created.length}` };
    },
    retrieve: async (id: string) => {
      const count = (polls.get(id) ?? 0) + 1;
      polls.set(id, count);
      return { processing_status: count >= 2 ? 'ended' : 'in_progress' };
    },
    results: async (id: string) => {
      const requests = created[Number(id.replace('batch', '')) - 1];
      return (async function* () {
        for (const entry of [...requests].reverse())
          yield { custom_id: entry.custom_id, result: answer(entry.params) };
      })();
    },
    cancel: async (id: string) => {
      cancelled.push(id);
      return {};
    },
  };
  const client = {
    beta: { messages: { batches } },
  } as unknown as Anthropic;
  return {
    client,
    created,
    cancelled,
    failCreateWith: (error: Error) => (failCreate = error),
  };
}

const textOf = (params: Request) => String(params.messages[0].content);

describe('MessageBatcher', () => {
  it('sends requests that arrive together as one batch, without fallbacks', async () => {
    const api = fakeBatches((params) => ({
      type: 'succeeded',
      message: message(`echo ${textOf(params)}`),
    }));
    const direct = vi.fn();
    const batcher = new MessageBatcher(api.client, direct, FAST);
    const replies = await Promise.all([
      batcher.send(request('a', { betas: ['x'], fallbacks: 'default' })),
      batcher.send(request('b')),
    ]);
    expect(replies.map((reply) => reply.content[0])).toEqual([
      { type: 'text', text: 'echo a' },
      { type: 'text', text: 'echo b' },
    ]);
    expect(api.created).toHaveLength(1);
    expect(api.created[0][0].params).not.toHaveProperty('betas');
    expect(api.created[0][0].params).not.toHaveProperty('fallbacks');
    expect(direct).not.toHaveBeenCalled();
  });

  it('turns an errored result into the error a direct request would throw', async () => {
    const api = fakeBatches(() => ({
      type: 'errored',
      error: {
        type: 'error',
        error: { type: 'rate_limit_error', message: 'Too many requests' },
        request_id: 'req_1',
      },
    }));
    const batcher = new MessageBatcher(api.client, vi.fn(), FAST);
    const error = await batcher.send(request('a')).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(Anthropic.APIError);
    expect(classifyProviderError(error)).toBeInstanceOf(RateLimitedError);
  });

  it('sends a refused request again directly, where fallbacks are allowed', async () => {
    const api = fakeBatches(() => ({
      type: 'succeeded',
      message: message('', 'refusal'),
    }));
    const direct = vi.fn(async () => message('from the fallback'));
    const batcher = new MessageBatcher(api.client, direct, FAST);
    const reply = await batcher.send(request('a', { fallbacks: 'default' }));
    expect(reply.content[0]).toEqual({
      type: 'text',
      text: 'from the fallback',
    });
    expect(direct).toHaveBeenCalledWith(
      expect.objectContaining({ fallbacks: 'default' }),
    );
  });

  it('gives every caller the error when the batch cannot be created', async () => {
    const api = fakeBatches(() => ({ type: 'canceled' }));
    api.failCreateWith(new Error('no credit'));
    const batcher = new MessageBatcher(api.client, vi.fn(), FAST);
    const errors = await Promise.all([
      batcher.send(request('a')).catch((e: Error) => e.message),
      batcher.send(request('b')).catch((e: Error) => e.message),
    ]);
    expect(errors).toEqual(['no credit', 'no credit']);
  });

  it('stops waiting on Parse now: the batch is cancelled and the rest goes direct', async () => {
    const api = fakeBatches(() => ({
      type: 'succeeded',
      message: message('late'),
    }));
    const direct = vi.fn(async (params: Request) =>
      message(`direct ${textOf(params)}`),
    );
    const batcher = new MessageBatcher(api.client, direct, {
      ...FAST,
      pollMs: 60_000,
    });
    const pending = batcher.send(request('a'));
    await vi.waitFor(() => expect(api.created).toHaveLength(1));
    batcher.hurry();
    expect((await pending).content[0]).toEqual({
      type: 'text',
      text: 'direct a',
    });
    expect(api.cancelled).toEqual(['batch1']);
    expect((await batcher.send(request('b'))).content[0]).toEqual({
      type: 'text',
      text: 'direct b',
    });
    expect(api.created).toHaveLength(1);
  });

  it('interrupts the waiting steps when the run is closed', async () => {
    const api = fakeBatches(() => ({
      type: 'succeeded',
      message: message('x'),
    }));
    const batcher = new MessageBatcher(api.client, vi.fn(), {
      ...FAST,
      pollMs: 60_000,
    });
    const pending = batcher.send(request('a')).catch((e: unknown) => e);
    await vi.waitFor(() => expect(api.created).toHaveLength(1));
    batcher.close();
    expect(await pending).toBeInstanceOf(StepInterruptedError);
    expect(api.cancelled).toEqual(['batch1']);
    await expect(batcher.send(request('b'))).rejects.toBeInstanceOf(
      StepInterruptedError,
    );
  });
});
