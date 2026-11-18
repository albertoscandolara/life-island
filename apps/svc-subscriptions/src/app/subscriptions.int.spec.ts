import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import {
  createServiceDb,
  paymentEventHandler,
  type ServiceDb,
} from '@life-island/be-common';
import {
  isoAddDays,
  isoAddMonths,
  type DeadlineDto,
  type EventEnvelope,
  type LifeAttentionDto,
  type PayableDto,
  type RenewalAdviceDto,
  type SubscriptionsOverviewDto,
} from '@life-island/contracts';
import { createApp } from './bootstrap.js';
import { loadConfig } from './config.js';
import { today } from './subscriptions/subscriptions.service.js';

// Needs the compose stack: `npm run infra:up`, then `npm run test:integration`.
const configured = !!process.env['SUBSCRIPTIONS_DATABASE_URL'];

describe.skipIf(!configured)(
  'Subscriptions (contracts, renewals, price changes, advisor over HTTP)',
  () => {
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
        schema: 'subscriptions',
      });
    });

    afterAll(async () => {
      for (const id of ids) {
        await svc?.pool.query(
          `delete from subscriptions.payments where payable_key like $1`,
          [`subscriptions:charge:${id}.%`],
        );
        await svc?.pool.query(
          'delete from subscriptions.contracts where id = $1',
          [id],
        );
      }
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
      expect(
        (await json('PUT', `/items/${gym.body.id}`, { cost: 540 })).status,
      ).toBe(204);

      const overview = await json<SubscriptionsOverviewDto>('GET', '/overview');
      const mine = overview.body.items.find((i) => i.id === gym.body.id)!;
      expect(mine).toMatchObject({
        monthly: 45,
        yearly: 540,
        nextRenewal: isoAddDays(day, 10),
        daysToCancelBy: -20,
      });
      expect(mine.priceChanges).toEqual([{ date: day, from: 480, to: 540 }]);
      expect(overview.body.totals.unused).toBeGreaterThanOrEqual(540);

      const deadlines = await json<DeadlineDto[]>('GET', '/deadlines');
      const kinds = deadlines.body
        .filter((d) => d.title.includes('Test gym'))
        .map((d) => d.kind)
        .sort();
      expect(kinds).toEqual(['cancel-by', 'renewal']);
    });

    it('lists every charge for Money, and learns what the bank really charged', async () => {
      const day = today();
      const renewsOn = isoAddMonths(day, -6);
      const created = await json<{ id: string }>('POST', '/items', {
        name: 'Test streaming',
        provider: 'Streamflix',
        kind: 'streaming',
        cost: 12.99,
        cycle: 'monthly',
        renewsOn,
      });
      expect(created.status).toBe(201);
      const id = created.body.id;
      ids.push(id);

      const charge = isoAddMonths(renewsOn, 3);
      const payables = await json<PayableDto[]>(
        'GET',
        `/payables?from=${charge}&to=${charge}`,
      );
      expect(payables.status).toBe(200);
      const mine = payables.body.find((p) =>
        p.key.startsWith(`subscriptions:charge:${id}.`),
      )!;
      expect(mine).toMatchObject({
        key: `subscriptions:charge:${id}.${charge}`,
        module: 'subscriptions',
        kind: 'charge',
        amount: 12.99,
        direction: 'out',
        date: charge,
        window: { from: isoAddDays(charge, -5), to: isoAddDays(charge, 10) },
        tolerance: 0.1,
        autoPay: true,
        payees: ['Streamflix', 'Test streaming'],
        path: '/subscriptions',
      });
      expect(
        (await json('GET', '/payables?from=2026-02-01&to=2026-01-01')).status,
      ).toBe(400);

      // Money links a charge 1 € over the price (as "check it", confirmed).
      const deliver = async (type: string, payload: unknown) => {
        const client = await svc.pool.connect();
        try {
          await paymentEventHandler('subscriptions', 'subscriptions')(
            { type, payload } as EventEnvelope,
            client,
          );
        } finally {
          client.release();
        }
      };
      const linkId = randomUUID();
      await deliver('money.payment_linked@1', {
        linkId,
        payableKey: mine.key,
        module: 'subscriptions',
        movementId: randomUUID(),
        date: isoAddDays(charge, 1),
        amount: 13.99,
        accountName: 'Conto corrente',
        description: 'STREAMFLIX.COM',
        linkedAt: new Date().toISOString(),
      });
      // Another area's payment is not ours.
      await deliver('money.payment_linked@1', {
        linkId: randomUUID(),
        payableKey: `home:bill:${randomUUID()}`,
        module: 'home',
        movementId: randomUUID(),
        date: charge,
        amount: 50,
        accountName: 'Conto corrente',
        description: 'ENEL',
        linkedAt: new Date().toISOString(),
      });

      const itemOf = async () =>
        (
          await json<SubscriptionsOverviewDto>('GET', '/overview')
        ).body.items.find((i) => i.id === id)!;
      expect((await itemOf()).lastCharge).toEqual({
        date: charge,
        paid: 13.99,
        expected: 12.99,
        paidOn: isoAddDays(charge, 1),
        accounts: ['Conto corrente'],
        priceRise: 1,
      });
      const risen = async () =>
        (await json<LifeAttentionDto>('GET', '/attention')).body.items!.filter(
          (i) => i.id.startsWith(`price-rise:${id}:`),
        );
      expect(await risen()).toMatchObject([
        { kind: 'price-rise', action: 'Update the cost' },
      ]);

      // Once the cost is updated, the rise is history, not a warning.
      expect((await json('PUT', `/items/${id}`, { cost: 13.99 })).status).toBe(
        204,
      );
      expect(await risen()).toEqual([]);
      expect((await itemOf()).lastCharge?.priceRise).toBe(1);

      // Undone in Money: the charge is unmatched again.
      await deliver('money.payment_unlinked@1', {
        linkId,
        payableKey: mine.key,
        module: 'subscriptions',
        reason: 'undone',
        unlinkedAt: new Date().toISOString(),
      });
      expect((await itemOf()).lastCharge).toBeNull();
    });

    it('advises with its own rules when there is no key', async () => {
      const advice = await json<RenewalAdviceDto>('POST', '/advice', {});
      expect(advice.status).toBe(201);
      expect(advice.body.source).toBe('offline');
      expect(
        advice.body.output.verdicts.find((v) => v.name === 'Test gym')?.verdict,
      ).toBe('cancel');
      expect((await json('DELETE', `/advice/${advice.body.id}`)).status).toBe(
        204,
      );
    });
  },
);
