import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import { createServiceDb, type ServiceDb } from '@life-island/be-common';
import { randomBytes, randomUUID } from 'node:crypto';
import { createApp } from '../bootstrap.js';
import { loadConfig } from '../config.js';

// Needs the compose stack: `npm run infra:up`, then `npm run test:integration`.
const configured = !!process.env['SETTINGS_DATABASE_URL'];

describe.skipIf(!configured)(
  'AI spending guard (reserve and settle over HTTP)',
  () => {
    let app: INestApplication;
    let base: string;
    let svc: ServiceDb;
    const token = randomBytes(32).toString('base64url');
    const saved = process.env['INTERNAL_TOKEN'];
    const user = `guard-test-${randomUUID()}`;

    const call = async (path: string, body: unknown, internal = true) => {
      const response = await fetch(`${base}${path}`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(internal ? { 'x-internal-token': token } : {}),
        },
        body: JSON.stringify(body),
      });
      const text = await response.text();
      return {
        status: response.status,
        body: (text ? JSON.parse(text) : {}) as Record<string, unknown>,
      };
    };
    const reserve = (maxUsd: number, userId: string | null = user) =>
      call('/ai-guard/reserve', {
        toolId: 'money.review',
        service: 'svc-money',
        userId,
        maxUsd,
      });

    beforeAll(async () => {
      process.env['INTERNAL_TOKEN'] = token;
      const config = {
        ...loadConfig(),
        port: 0,
        aiLimits: {
          monthlyUsd: 1000,
          userDailyUsd: 1,
          userPerMinute: 4,
          userPerHour: 100,
          maxCallUsd: 0.6,
        },
      };
      svc = createServiceDb({
        connectionString: config.databaseUrl,
        schema: 'settings',
      });
      app = await createApp(config, { events: false });
      await app.listen(0);
      base = (await app.getUrl()).replace('[::1]', 'localhost');
    });

    afterAll(async () => {
      await svc?.pool.query(
        'delete from settings.ai_reservations where user_id = $1',
        [user],
      );
      await svc?.close();
      await app?.close();
      if (saved === undefined) delete process.env['INTERNAL_TOKEN'];
      else process.env['INTERNAL_TOKEN'] = saved;
    });

    it('is only for the island services', async () => {
      const browser = await call(
        '/ai-guard/reserve',
        { toolId: 't', service: 's', userId: null, maxUsd: 0.1 },
        false,
      );
      expect(browser.status).toBe(403);
    });

    it('refuses one call above the per-call limit', async () => {
      expect((await reserve(0.7)).status).toBe(429);
    });

    it('counts reserved and settled spend against the daily allowance', async () => {
      const first = await reserve(0.5);
      expect(first.status).toBe(200);
      // Still running: its whole reservation counts.
      expect((await reserve(0.55)).status).toBe(429);
      // Settled at its real, smaller cost: room again.
      const settled = await call(
        `/ai-guard/reservations/${first.body['reservationId']}/settle`,
        { actualUsd: 0.1 },
      );
      expect(settled.status).toBe(204);
      expect((await reserve(0.55)).status).toBe(200);
    });

    it('limits calls per minute', async () => {
      // Two kept so far this minute (a refused call is not kept); the limit is 4.
      expect((await reserve(0.01)).status).toBe(200);
      expect((await reserve(0.01)).status).toBe(200);
      const fifth = await reserve(0.01);
      expect(fifth.status).toBe(429);
      expect(fifth.body['message']).toMatch(/in a minute/);
    });
  },
);
