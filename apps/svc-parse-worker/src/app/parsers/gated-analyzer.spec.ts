import type { ServiceDb } from '@life-island/be-common';
import type {
  DocumentAnalyzer,
  ParseInput,
  ParseRunRecord,
} from './document-parser.js';
import { GatedAnalyzer, usageOf } from './gated-analyzer.js';

const input: ParseInput = {
  document: { kind: 'text', text: 'Fattura n. 12' },
  filename: 'fattura.txt',
  title: 'Fattura',
  description: null,
};

function analyzer(name: string, runs: ParseRunRecord[] = []): DocumentAnalyzer {
  const output = (result: unknown) =>
    vi.fn().mockResolvedValue({ result, runs });
  return {
    name,
    classify: output({ by: name }),
    discover: output({ suggestions: [] }),
    extract: output({ by: name }),
    matchCategories: output({ matches: [] }),
    readTransaction: output({ by: name }),
  };
}

/** A pool whose replica holds `replica`, recording the events written to the outbox. */
function fakeDb(replica: Record<string, unknown>) {
  const events: {
    type: string;
    payload: { toolId: string; steps: unknown[] };
  }[] = [];
  const query = vi.fn(async (sql: string, params: unknown[] = []) => {
    if (sql.includes('settings_replica')) {
      const keys = params[0] as string[];
      return {
        rows: keys
          .filter((key) => key in replica)
          .map((key) => ({ key, value: replica[key] })),
      };
    }
    if (sql.includes('outbox')) {
      events.push({
        type: params[0] as string,
        payload: JSON.parse(params[1] as string),
      });
      return { rows: [{ id: 'e' }] };
    }
    return { rows: [] };
  });
  const pool = {
    query,
    connect: async () => ({ query, release: () => undefined }),
  };
  return { svc: { pool, schema: 'ingestion' } as unknown as ServiceDb, events };
}

const run: ParseRunRecord = {
  step: 'classify',
  model: 'claude-haiku-5-5',
  promptVersion: 'test',
  inputTokens: 1200,
  outputTokens: 300,
  latencyMs: 900,
};

describe('GatedAnalyzer', () => {
  it('calls the model while the tool is on and records the use', async () => {
    const ai = analyzer('claude', [run]);
    const offline = analyzer('offline');
    const { svc, events } = fakeDb({});
    const gated = new GatedAnalyzer(ai, offline, svc);

    const output = await gated.classify(input, []);

    expect(output.result).toEqual({ by: 'claude' });
    expect(offline.classify).not.toHaveBeenCalled();
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('ai.tool_used@1');
    expect(events[0].payload.toolId).toBe('documents.classify');
    expect(events[0].payload.steps).toEqual(usageOf([run]));
  });

  it('runs a step offline when its tool is switched off in Settings', async () => {
    const ai = analyzer('claude', [run]);
    const offline = analyzer('offline');
    const { svc, events } = fakeDb({ 'ai-tool.documents.extract': false });
    const gated = new GatedAnalyzer(ai, offline, svc);

    const plan = {} as Parameters<DocumentAnalyzer['extract']>[1];
    expect((await gated.extract(input, plan)).result).toEqual({
      by: 'offline',
    });
    expect(ai.extract).not.toHaveBeenCalled();
    // Other tools keep calling the model.
    expect((await gated.classify(input, [])).result).toEqual({ by: 'claude' });
    expect(events.map((e) => e.payload.toolId)).toEqual(['documents.classify']);
  });

  it('runs every step offline with the master switch off', async () => {
    const ai = analyzer('claude', [run]);
    const offline = analyzer('offline');
    const { svc, events } = fakeDb({ 'ai.enabled': false });
    const gated = new GatedAnalyzer(ai, offline, svc);

    const context = { analysis: null, categories: [] };
    expect((await gated.readTransaction(input, context)).result).toEqual({
      by: 'offline',
    });
    expect(events).toHaveLength(0);
  });

  it('records the calls of a failed step and rethrows', async () => {
    const ai = analyzer('claude');
    const failure = Object.assign(new Error('boom'), {
      runs: [{ ...run, step: 'transaction' as const, error: 'boom' }],
    });
    vi.mocked(ai.readTransaction).mockRejectedValue(failure);
    const { svc, events } = fakeDb({});
    const gated = new GatedAnalyzer(ai, analyzer('offline'), svc);

    await expect(
      gated.readTransaction(input, { analysis: null, categories: [] }),
    ).rejects.toThrow('boom');
    expect(events[0].payload).toMatchObject({
      toolId: 'documents.transactions',
      outcome: 'error',
    });
  });
});
