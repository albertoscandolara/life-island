import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import { createServiceDb, type ServiceDb } from '@life-island/be-common';
import {
  isoAddMonths,
  type DeadlineDto,
  type MoneyOverviewDto,
  type SpendingReviewDto,
} from '@life-island/contracts';
import { createApp } from './bootstrap.js';
import { loadConfig } from './config.js';
import { today } from './money/money.service.js';

// Needs the compose stack: `npm run infra:up`, then `npm run test:integration`.
const configured = !!process.env['MONEY_DATABASE_URL'];

describe.skipIf(!configured)(
  'Money (accounts, import, budgets, recurring, review over HTTP)',
  () => {
    let app: INestApplication;
    let base: string;
    let svc: ServiceDb;
    let accountId = '';

    const json = async <T>(method: string, path: string, body?: unknown) => {
      const response = await fetch(`${base}${path}`, {
        method,
        headers: body ? { 'content-type': 'application/json' } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });
      const text = await response.text();
      return {
        status: response.status,
        body: (text ? JSON.parse(text) : undefined) as T,
      };
    };

    beforeAll(async () => {
      const config = { ...loadConfig(), port: 0, anthropicApiKey: null };
      app = await createApp(config, { events: false });
      await app.listen(0);
      base = (await app.getUrl()).replace('[::1]', 'localhost');
      svc = createServiceDb({
        connectionString: config.databaseUrl,
        schema: 'money',
      });
    });

    afterAll(async () => {
      if (accountId)
        await svc?.pool.query('delete from money.accounts where id = $1', [
          accountId,
        ]);
      await svc?.pool.query(
        "delete from money.budgets where category = 'eating-out'",
      );
      await svc?.close();
      await app?.close();
    });

    it('adds an account, imports movements, finds the recurring charges and sends them to the agenda', async () => {
      const day = today();
      const month = (n: number) => `${isoAddMonths(day, -n).slice(0, 8)}05`;
      const account = await json<{ id: string }>('POST', '/accounts', {
        name: 'Test current account',
        openingBalance: 1000,
        openingDate: isoAddMonths(day, -6),
      });
      expect(account.status).toBe(201);
      accountId = account.body.id;

      const rows = [1, 2, 3].flatMap((n) => [
        { date: month(n), amount: 2000, description: 'Stipendio ACME' },
        {
          date: month(n),
          amount: -12.99,
          description: `NETFLIX.COM ${n}2/0${n}`,
        },
        { date: month(n), amount: -60, description: 'Pizzeria da Gino' },
      ]);
      const imported = await json<{ added: number; skipped: number }>(
        'POST',
        '/transactions/import',
        {
          accountId,
          rows: [...rows, rows[0]],
        },
      );
      expect(imported.body).toEqual({ added: 9, skipped: 1 });

      expect(
        (
          await json('POST', '/budgets', {
            category: 'eating-out',
            monthlyLimit: 50,
          })
        ).status,
      ).toBe(201);

      const overview = await json<MoneyOverviewDto>('GET', '/overview');
      expect(overview.status).toBe(200);
      const mine = overview.body.accounts.find((a) => a.id === accountId);
      expect(mine?.balance).toBeCloseTo(1000 + 3 * (2000 - 12.99 - 60));
      expect(
        overview.body.transactions.find((t) =>
          t.description.startsWith('NETFLIX'),
        )?.category,
      ).toBe('subscriptions');
      const netflix = overview.body.recurring.find(
        (r) => r.category === 'subscriptions',
      );
      expect(netflix).toMatchObject({ amount: 12.99, months: 3 });

      const deadlines = await json<DeadlineDto[]>('GET', '/deadlines');
      expect(
        deadlines.body.some(
          (d) => d.module === 'money' && d.kind === 'recurring',
        ),
      ).toBe(true);
    });

    it('writes the spending review with its own rules when there is no key', async () => {
      const review = await json<SpendingReviewDto>('POST', '/reviews', {});
      expect(review.status).toBe(201);
      expect(review.body.source).toBe('offline');
      expect(review.body.output.summary).toMatch(/spent/);
      expect((await json('DELETE', `/reviews/${review.body.id}`)).status).toBe(
        204,
      );
    });

    it('refuses a movement of 0', async () => {
      const bad = await json('POST', '/transactions', {
        accountId: accountId || '00000000-0000-4000-8000-000000000000',
        date: today(),
        amount: 0,
        description: 'Nothing',
      });
      expect(bad.status).toBe(400);
    });
  },
);
