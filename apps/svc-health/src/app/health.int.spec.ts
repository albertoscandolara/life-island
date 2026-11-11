import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import { createServiceDb, type ServiceDb } from '@life-island/be-common';
import {
  isoAddDays,
  isoAddMonths,
  type DeadlineDto,
  type HealthOverviewDto,
  type ResultsExplanationDto,
} from '@life-island/contracts';
import { createApp } from './bootstrap.js';
import { loadConfig } from './config.js';
import { today } from './health/health.service.js';

// Needs the compose stack: `npm run infra:up`, then `npm run test:integration`.
const configured = !!process.env['HEALTH_DATABASE_URL'];
const PERSON = 'Test person (health spec)';

describe.skipIf(!configured)(
  'Health (records, series, checkups, explainer over HTTP)',
  () => {
    let app: INestApplication;
    let base: string;
    let svc: ServiceDb;

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
        schema: 'health',
      });
    });

    afterAll(async () => {
      for (const table of [
        'visits',
        'medicines',
        'test_results',
        'vaccinations',
        'checkups',
        'explanations',
      ])
        await svc?.pool.query(`delete from health.${table} where person = $1`, [
          PERSON,
        ]);
      await svc?.close();
      await app?.close();
    });

    it('keeps results as series, works out checkups and sends the dates to the agenda', async () => {
      const day = today();
      for (const [date, value] of [
        [isoAddMonths(day, -12), 180],
        [isoAddMonths(day, -1), 215],
      ] as const)
        expect(
          (
            await json('POST', '/results', {
              date,
              person: PERSON,
              test: 'Cholesterol',
              value,
              unit: 'mg/dL',
              high: 200,
            })
          ).status,
        ).toBe(201);
      await json('POST', '/checkups', {
        person: PERSON,
        name: 'Dental check',
        everyMonths: 6,
        lastDoneOn: isoAddMonths(day, -7),
      });
      await json('POST', '/medicines', {
        person: PERSON,
        name: 'Vitamin D',
        refillOn: isoAddDays(day, 5),
      });
      await json('POST', '/visits', {
        date: day,
        person: PERSON,
        kind: 'dentist',
        cost: 90,
        followUpOn: isoAddDays(day, 30),
      });

      const overview = await json<HealthOverviewDto>('GET', '/overview');
      expect(overview.body.people).toContain(PERSON);
      const cholesterol = overview.body.series.find((s) => s.person === PERSON);
      expect(cholesterol).toMatchObject({ trend: 'up' });
      expect(cholesterol?.points.at(-1)?.flag).toBe('high');
      expect(
        overview.body.checkups.find((c) => c.person === PERSON)?.overdue,
      ).toBe(true);
      expect(overview.body.costs.deductible).toBeGreaterThanOrEqual(90);

      const deadlines = await json<DeadlineDto[]>('GET', '/deadlines');
      const mine = deadlines.body.filter((d) => d.title.includes(PERSON));
      // The overdue checkup is in the window too (it looks 60 days back).
      expect(mine.map((d) => d.kind).sort()).toEqual([
        'checkup',
        'follow-up',
        'refill',
      ]);
    });

    it('explains the results with its own rules when there is no key', async () => {
      const answer = await json<ResultsExplanationDto>(
        'POST',
        '/explanations',
        { person: PERSON },
      );
      expect(answer.status).toBe(201);
      expect(answer.body.source).toBe('offline');
      expect(answer.body.output.items[0]?.test).toBe('Cholesterol');
      expect(
        (await json('DELETE', `/explanations/${answer.body.id}`)).status,
      ).toBe(204);
    });
  },
);
