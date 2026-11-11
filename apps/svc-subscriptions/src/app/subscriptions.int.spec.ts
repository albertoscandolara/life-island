import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import { createServiceDb, type ServiceDb } from '@life-island/be-common';
import {
  isoAddDays,
  isoAddMonths,
  type DeadlineDto,
  type RenewalAdviceDto,
  type SubscriptionsOverviewDto,
} from '@life-island/contracts';
import { createApp } from './bootstrap.js';
import { loadConfig } from './config.js';
import { today } from './subscriptions/subscriptions.service.js';

// Needs the compose stack: `npm run infra:up`, then `npm run test:integration`.
const configured = !!process.env['SUBSCRIPTIONS_DATABASE_URL'];

describe.skipIf(!configured)('Subscriptions (contracts, renewals, price changes, advisor over HTTP)', () => {
  let app: INestApplication;
  let base: string;
  let svc: ServiceDb;
  const ids: string[] = [];

  const json = async <T>(method: string, path: string, body?: unknown) => {
    const response = await fetch(`${base}${path}`, {
      method,
      headers: body ? { 'content-type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await response.text();
    return { status: response.status, body: (text ? JSON.parse(text) : undefined) as T };
  };

  beforeAll(async () => {
    const config = { ...loadConfig(), port: 0, anthropicApiKey: null };
    app = await createApp(config, { events: false });
    await app.listen(0);
    base = (await app.getUrl()).replace('[::1]', 'localhost');
    svc = createServiceDb({ connectionString: config.databaseUrl, schema: 'subscriptions' });
  });

  afterAll(async () => {
    for (const id of ids) await svc?.pool.query('delete from subscriptions.contracts where id = $1', [id]);
    await svc?.close();
    await app?.close();
  });

  it('rolls the renewal forward, works out the cancel-by date and keeps the price history', async () => {
    const day = today();
    // Renewed yearly since two years ago; next renewal in 10 days, 30 days of notice.
    const gym = await json<{ id: string }>('POST', '/items', {
      name: 'Test gym',
      kind: 'gym',
      cost: 480,
      cycle: 'yearly',
      renewsOn: isoAddMonths(isoAddDays(day, 10), -24),
      noticeDays: 30,
      usage: 'never',
    });
    expect(gym.status).toBe(201);
    ids.push(gym.body.id);
    expect((await json('PUT', `/items/${gym.body.id}`, { cost: 540 })).status).toBe(204);

    const overview = await json<SubscriptionsOverviewDto>('GET', '/overview');
    const mine = overview.body.items.find((i) => i.id === gym.body.id)!;
    expect(mine).toMatchObject({ monthly: 45, yearly: 540, nextRenewal: isoAddDays(day, 10), daysToCancelBy: -20 });
    expect(mine.priceChanges).toEqual([{ date: day, from: 480, to: 540 }]);
    expect(overview.body.totals.unused).toBeGreaterThanOrEqual(540);

    const deadlines = await json<DeadlineDto[]>('GET', '/deadlines');
    const kinds = deadlines.body.filter((d) => d.title.includes('Test gym')).map((d) => d.kind).sort();
    expect(kinds).toEqual(['cancel-by', 'renewal']);
  });

  it('advises with its own rules when there is no key', async () => {
    const advice = await json<RenewalAdviceDto>('POST', '/advice', {});
    expect(advice.status).toBe(201);
    expect(advice.body.source).toBe('offline');
    expect(advice.body.output.verdicts.find((v) => v.name === 'Test gym')?.verdict).toBe('cancel');
    expect((await json('DELETE', `/advice/${advice.body.id}`)).status).toBe(204);
  });
});
