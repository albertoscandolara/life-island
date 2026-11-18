import type { EventEnvelope } from '@life-island/contracts';
import type pg from 'pg';
import { paymentEventHandler } from './payments.js';

const event = (type: string, payload: unknown): EventEnvelope => ({
  id: '00000000-0000-4000-8000-000000000000',
  type,
  source: 'svc-money',
  occurredAt: '2026-11-18T08:00:00.000Z',
  payload,
});

const linked = {
  linkId: '11111111-1111-4111-8111-111111111111',
  payableKey: 'home:bill:4d1c',
  module: 'home',
  movementId: '22222222-2222-4222-8222-222222222222',
  date: '2026-11-10',
  amount: 84.37,
  accountName: 'Current account',
  description: 'ADDEBITO SDD ENEL ENERGIA',
  linkedAt: '2026-11-18T08:00:00.000Z',
};

describe('paymentEventHandler', () => {
  const run = async (e: EventEnvelope) => {
    const calls: { sql: string; params: unknown[] }[] = [];
    const client = {
      query: async (sql: string, params: unknown[]) => {
        calls.push({ sql, params });
        return { rows: [], rowCount: 1 };
      },
    } as unknown as pg.PoolClient;
    await paymentEventHandler('home', 'home')(e, client);
    return calls;
  };

  it('keeps a payment once, by its link', async () => {
    const [call] = await run(event('money.payment_linked@1', linked));
    expect(call.sql).toMatch(/insert into home\.payments/);
    expect(call.sql).toMatch(/on conflict \(link_id\) do nothing/);
    expect(call.params).toEqual([
      linked.linkId,
      'home:bill:4d1c',
      84.37,
      '2026-11-10',
      'Current account',
      'ADDEBITO SDD ENEL ENERGIA',
    ]);
  });

  it('marks an undone link, even when it never arrived', async () => {
    const [call] = await run(
      event('money.payment_unlinked@1', {
        linkId: linked.linkId,
        payableKey: linked.payableKey,
        module: 'home',
        reason: 'undone',
        unlinkedAt: '2026-11-18T09:00:00.000Z',
      }),
    );
    expect(call.sql).toMatch(/do update set unlinked_at/);
  });

  it('ignores the items of another area, and refuses a bad payload', async () => {
    expect(
      await run(
        event('money.payment_linked@1', {
          ...linked,
          payableKey: 'taxes:expense:9',
          module: 'taxes',
        }),
      ),
    ).toEqual([]);
    await expect(
      run(event('money.payment_linked@1', { ...linked, amount: -1 })),
    ).rejects.toThrow();
  });
});
