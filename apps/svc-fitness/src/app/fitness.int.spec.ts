import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import { createServiceDb, type ServiceDb } from '@life-island/be-common';
import {
  isoAddDays,
  isoWeekStart,
  type DeadlineDto,
  type FitnessOverviewDto,
  type TrainingPlanDto,
} from '@life-island/contracts';
import { createApp } from './bootstrap.js';
import { loadConfig } from './config.js';
import { today } from './fitness/fitness.service.js';

// Needs the compose stack: `npm run infra:up`, then `npm run test:integration`.
const configured = !!process.env['FITNESS_DATABASE_URL'];

describe.skipIf(!configured)('Fitness (workouts, weeks, events, plan over HTTP)', () => {
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
    return { status: response.status, body: (text ? JSON.parse(text) : undefined) as T };
  };

  beforeAll(async () => {
    const config = { ...loadConfig(), port: 0, anthropicApiKey: null };
    app = await createApp(config, { events: false });
    await app.listen(0);
    base = (await app.getUrl()).replace('[::1]', 'localhost');
    svc = createServiceDb({ connectionString: config.databaseUrl, schema: 'fitness' });
    await svc.pool.query("delete from fitness.workouts where notes = 'fitness spec'");
  });

  afterAll(async () => {
    await svc?.pool.query("delete from fitness.workouts where notes = 'fitness spec'");
    await svc?.pool.query("delete from fitness.events where notes = 'fitness spec'");
    await svc?.close();
    await app?.close();
  });

  it('counts active minutes per week, the streak and the events', async () => {
    const day = today();
    const lastWeek = isoAddDays(isoWeekStart(day), -7);
    // Last week: 80 hard minutes = 160 active, at the 150 goal.
    expect((await json('POST', '/workouts', { date: lastWeek, kind: 'run', minutes: 80, intensity: 'hard', notes: 'fitness spec' })).status).toBe(201);
    await json('POST', '/workouts', { date: day, kind: 'walk', minutes: 40, intensity: 'easy', notes: 'fitness spec' });
    await json('POST', '/events', { name: 'Test 10 km', date: isoAddDays(day, 30), target: 'under 55 min', notes: 'fitness spec' });

    const overview = await json<FitnessOverviewDto>('GET', '/overview');
    expect(overview.status).toBe(200);
    expect(overview.body.goalMinutes).toBe(150);
    const weeks = overview.body.weeks;
    expect(weeks).toHaveLength(12);
    expect(weeks[10].activeMinutes).toBeGreaterThanOrEqual(160);
    expect(weeks[11].activeMinutes).toBeGreaterThanOrEqual(20);
    expect(overview.body.stats.streak).toBeGreaterThanOrEqual(1);

    const deadlines = await json<DeadlineDto[]>('GET', '/deadlines');
    expect(deadlines.body.find((d) => d.title === 'Test 10 km')).toMatchObject({ kind: 'event', detail: 'Target: under 55 min' });
  });

  it('plans the week with its own rules when there is no key', async () => {
    const plan = await json<TrainingPlanDto>('POST', '/plans', {});
    expect(plan.status).toBe(201);
    expect(plan.body.source).toBe('offline');
    expect(plan.body.output.days).toHaveLength(7);
    expect((await json('DELETE', `/plans/${plan.body.id}`)).status).toBe(204);
  });
});
