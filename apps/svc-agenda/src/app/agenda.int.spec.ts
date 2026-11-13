import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import { createServiceDb, type ServiceDb } from '@life-island/be-common';
import {
  isoAddDays,
  type AgendaBriefDto,
  type AgendaOverviewDto,
  type AgendaUpcomingDto,
  type LifeAttentionDto,
} from '@life-island/contracts';
import { createApp } from './bootstrap.js';
import { loadConfig } from './config.js';
import { today } from './agenda/agenda.service.js';

// Needs the compose stack: `npm run infra:up`, then `npm run test:integration`.
const configured = !!process.env['AGENDA_DATABASE_URL'];

describe.skipIf(!configured)(
  'Agenda (items, areas, handled dates, brief over HTTP)',
  () => {
    let app: INestApplication;
    let base: string;
    let svc: ServiceDb;
    let area: { close(): void } | null = null;
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
      // A fake "cars" area answering GET /deadlines; every other area is unreachable.
      const { createServer } = await import('node:http');
      const day = today();
      const server = createServer((req, res) => {
        res.setHeader('content-type', 'application/json');
        res.end(
          JSON.stringify([
            {
              id: `insurance:car-1:${isoAddDays(day, 3)}`,
              module: 'cars',
              kind: 'insurance',
              title: 'Insurance of the Panda',
              detail: null,
              date: isoAddDays(day, 3),
              amount: 420,
              path: '/cars',
            },
          ]),
        );
      });
      await new Promise<void>((resolve) => server.listen(0, resolve));
      const port = (server.address() as { port: number }).port;
      area = { close: () => server.close() };
      const config = {
        ...loadConfig(),
        port: 0,
        anthropicApiKey: null,
        sources: {
          cars: `http://localhost:${port}`,
          people: 'http://localhost:9',
        },
      };
      app = await createApp(config, { events: false });
      await app.listen(0);
      base = (await app.getUrl()).replace('[::1]', 'localhost');
      svc = createServiceDb({
        connectionString: config.databaseUrl,
        schema: 'agenda',
      });
    });

    afterAll(async () => {
      for (const id of ids)
        await svc?.pool.query('delete from agenda.agenda_items where id = $1', [
          id,
        ]);
      await svc?.pool.query(
        "delete from agenda.handled_entries where key like 'module:cars:insurance:car-1:%'",
      );
      await svc?.close();
      await app?.close();
      area?.close();
    });

    it('merges the areas, your items and the calendar, and marks a date as handled', async () => {
      const day = today();
      const added = await json<{ id: string }>('POST', '/items', {
        title: 'Call the plumber',
        date: isoAddDays(day, -2),
      });
      expect(added.status).toBe(201);
      ids.push(added.body.id);
      const monthly = await json<{ id: string }>('POST', '/items', {
        title: 'Pay the rent',
        date: isoAddDays(day, 1),
        repeat: 'monthly',
        category: 'money',
      });
      ids.push(monthly.body.id);

      const overview = await json<AgendaOverviewDto>('GET', '/overview');
      expect(overview.status).toBe(200);
      const cars = overview.body.sources.find((s) => s.module === 'cars');
      expect(cars).toMatchObject({ ok: true, count: 1 });
      expect(overview.body.sources.find((s) => s.module === 'people')?.ok).toBe(
        false,
      );
      // The calendar files dates under Cars too (winter tyres from 15 November).
      const insurance = overview.body.entries.find(
        (e) => e.module === 'cars' && e.source === 'module',
      );
      expect(insurance).toMatchObject({
        daysLeft: 3,
        urgency: 'week',
        handled: false,
      });
      expect(
        overview.body.entries.filter((e) => e.itemId === monthly.body.id)
          .length,
      ).toBeGreaterThanOrEqual(12);
      expect(
        overview.body.entries.find((e) => e.itemId === added.body.id)?.urgency,
      ).toBe('overdue');
      expect(overview.body.entries.some((e) => e.source === 'calendar')).toBe(
        true,
      );

      const attention = await json<LifeAttentionDto>('GET', '/attention');
      expect(attention.body.expired).toBeGreaterThanOrEqual(1);
      expect(attention.body.expiring).toBeGreaterThanOrEqual(2);

      expect(
        (await json('PUT', '/handled', { key: insurance!.key, handled: true }))
          .status,
      ).toBe(204);
      expect(
        (
          await json('PUT', '/handled', {
            key: `item:${added.body.id}:x`,
            handled: true,
          })
        ).status,
      ).toBe(204);
      const upcoming = await json<AgendaUpcomingDto>('GET', '/upcoming?days=7');
      expect(upcoming.body.entries.some((e) => e.key === insurance!.key)).toBe(
        false,
      );
      expect(
        upcoming.body.entries.some((e) => e.itemId === added.body.id),
      ).toBe(false);
    });

    it('writes the week brief with its own rules when there is no key', async () => {
      const brief = await json<AgendaBriefDto>('POST', '/briefs', {});
      expect(brief.status).toBe(201);
      expect(brief.body.source).toBe('offline');
      expect(brief.body.output.summary).toBeTruthy();
      expect((await json('DELETE', `/briefs/${brief.body.id}`)).status).toBe(
        204,
      );
    });

    it('refuses an item without a title', async () => {
      const bad = await json<{ issues: unknown[] }>('POST', '/items', {
        date: today(),
      });
      expect(bad.status).toBe(400);
    });
  },
);
