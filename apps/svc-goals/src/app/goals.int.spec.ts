import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import { createServiceDb, type ServiceDb } from '@life-island/be-common';
import {
  isoAddDays,
  isoWeekStart,
  type DeadlineDto,
  type GoalsCoachDto,
  type GoalsOverviewDto,
} from '@life-island/contracts';
import { createApp } from './bootstrap.js';
import { loadConfig } from './config.js';
import { today } from './goals/goals.service.js';

// Needs the compose stack: `npm run infra:up`, then `npm run test:integration`.
const configured = !!process.env['GOALS_DATABASE_URL'];

describe.skipIf(!configured)(
  'Goals (goals, steps, habits, reviews, coach over HTTP)',
  () => {
    let app: INestApplication;
    let base: string;
    let svc: ServiceDb;
    const goalIds: string[] = [];
    const habitIds: string[] = [];

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
        schema: 'goals',
      });
    });

    afterAll(async () => {
      for (const id of habitIds)
        await svc?.pool.query('delete from goals.habits where id = $1', [id]);
      for (const id of goalIds)
        await svc?.pool.query('delete from goals.goals where id = $1', [id]);
      await svc?.close();
      await app?.close();
    });

    it('tracks a goal through its steps and sends its dates to the agenda', async () => {
      const day = today();
      const goal = await json<{ id: string }>('POST', '/goals', {
        title: 'Run a 10 km race',
        area: 'health',
        targetDate: isoAddDays(day, 60),
      });
      expect(goal.status).toBe(201);
      goalIds.push(goal.body.id);
      const step = await json<{ id: string }>('POST', '/steps', {
        goalId: goal.body.id,
        title: 'Buy running shoes',
        dueDate: isoAddDays(day, 3),
      });
      await json('POST', '/steps', {
        goalId: goal.body.id,
        title: 'Run 5 km',
        dueDate: isoAddDays(day, 20),
      });

      let overview = await json<GoalsOverviewDto>('GET', '/overview');
      let mine = overview.body.goals.find((g) => g.id === goal.body.id);
      expect(mine).toMatchObject({ progress: 0, stuck: false, daysLeft: 60 });
      expect(mine?.nextStep?.title).toBe('Buy running shoes');

      expect(
        (await json('PUT', `/steps/${step.body.id}`, { done: true })).status,
      ).toBe(204);
      overview = await json<GoalsOverviewDto>('GET', '/overview');
      mine = overview.body.goals.find((g) => g.id === goal.body.id);
      expect(mine?.progress).toBe(50);
      expect(mine?.steps.find((s) => s.id === step.body.id)?.doneOn).toBe(day);

      const deadlines = await json<DeadlineDto[]>('GET', '/deadlines');
      expect(
        deadlines.body.filter(
          (d) => d.title === 'Run 5 km' || d.title === 'Goal: Run a 10 km race',
        ),
      ).toHaveLength(2);
    });

    it('counts a habit this week, and saves the weekly review once per week', async () => {
      const day = today();
      const habit = await json<{ id: string }>('POST', '/habits', {
        title: 'Stretch',
        perWeek: 1,
      });
      habitIds.push(habit.body.id);
      expect(
        (
          await json('PUT', `/habits/${habit.body.id}/checks`, {
            date: day,
            done: true,
          })
        ).status,
      ).toBe(204);
      await json('PUT', `/habits/${habit.body.id}/checks`, {
        date: isoAddDays(isoWeekStart(day), -7),
        done: true,
      });
      const overview = await json<GoalsOverviewDto>('GET', '/overview');
      expect(
        overview.body.habits.find((h) => h.id === habit.body.id),
      ).toMatchObject({ thisWeek: 1, streak: 2 });

      expect(
        (
          await json('PUT', '/weekly-reviews', {
            weekStart: day,
            mood: 4,
            wins: 'Ran twice',
          })
        ).status,
      ).toBe(204);
      expect(
        (
          await json('PUT', '/weekly-reviews', {
            weekStart: day,
            mood: 5,
            wins: 'Ran three times',
          })
        ).status,
      ).toBe(204);
      const after = await json<GoalsOverviewDto>('GET', '/overview');
      expect(after.body.reviewedThisWeek).toBe(true);
      expect(
        after.body.reviews.filter((r) => r.weekStart === isoWeekStart(day)),
      ).toHaveLength(1);
      await svc.pool.query(
        'delete from goals.weekly_reviews where week_start = $1',
        [isoWeekStart(day)],
      );
    });

    it('coaches with its own rules when there is no key', async () => {
      const advice = await json<GoalsCoachDto>('POST', '/advice', {});
      expect(advice.status).toBe(201);
      expect(advice.body.source).toBe('offline');
      expect(advice.body.output.encouragement).toBeTruthy();
      expect((await json('DELETE', `/advice/${advice.body.id}`)).status).toBe(
        204,
      );
    });
  },
);
