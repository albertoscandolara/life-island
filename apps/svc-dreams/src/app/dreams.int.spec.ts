import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import { createServiceDb, type ServiceDb } from '@life-island/be-common';
import {
  isoAddDays,
  type DeadlineDto,
  type DreamDto,
  type DreamsOverviewDto,
  type LifeAttentionDto,
} from '@life-island/contracts';
import { createApp } from './bootstrap.js';
import { loadConfig } from './config.js';
import { today } from './dreams/dreams.service.js';

// Needs the compose stack: `npm run infra:up`, then `npm run test:integration`.
const configured = !!process.env['DREAMS_DATABASE_URL'];

describe.skipIf(!configured)(
  'Dreams (questions, small steps, check-ins over HTTP)',
  () => {
    let app: INestApplication;
    let base: string;
    let svc: ServiceDb;
    const dreamIds: string[] = [];

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
      // No key and no other area running: Life Island's own rules, an empty safety net.
      const config = {
        ...loadConfig(),
        port: 0,
        anthropicApiKey: null,
        sources: { money: 'http://localhost:9' },
      };
      app = await createApp(config, { events: false });
      await app.listen(0);
      base = (await app.getUrl()).replace('[::1]', 'localhost');
      svc = createServiceDb({
        connectionString: config.databaseUrl,
        schema: 'dreams',
      });
    });

    afterAll(async () => {
      for (const id of dreamIds)
        await svc?.pool.query('delete from dreams.dreams where id = $1', [id]);
      await svc?.close();
      await app?.close();
    });

    it('asks first, then suggests small reversible steps, and slows down after hard check-ins', async () => {
      const created = await json<{ id: string }>('POST', '/dreams', {
        title: 'Work somewhere I feel valued',
        area: 'work',
        fears: 'Losing my income',
      });
      expect(created.status).toBe(201);
      const id = created.body.id;
      dreamIds.push(id);

      let overview = await json<DreamsOverviewDto>('GET', '/overview');
      let dream = overview.body.dreams.find((d) => d.id === id)!;
      expect(dream).toMatchObject({
        status: 'dreaming',
        pace: 'gentle',
        contextAreas: ['money', 'work', 'studies'],
      });
      expect(overview.body.aiSteps).toBe(false);

      // Questions: the area's own, and none about the fears already written.
      const asked = await json<DreamDto>('POST', `/dreams/${id}/questions`);
      expect(asked.status).toBe(201);
      expect(asked.body.opening).toContain('Work somewhere I feel valued');
      expect(asked.body.questions.length).toBeGreaterThanOrEqual(3);
      expect(
        asked.body.questions.some((q) => /scares you most/.test(q.question)),
      ).toBe(false);
      const first = asked.body.questions[0]!;
      expect(
        (await json('PUT', `/questions/${first.id}`, { answer: 'The growth.' }))
          .status,
      ).toBe(204);
      // Asking again keeps what you answered.
      const again = await json<DreamDto>('POST', `/dreams/${id}/questions`);
      expect(again.body.questions.find((q) => q.id === first.id)?.answer).toBe(
        'The growth.',
      );

      // Steps: gentle pace, so only tiny ones, each with how to undo it.
      const suggested = await json<DreamDto>(
        'POST',
        `/dreams/${id}/suggestions`,
        {},
      );
      expect(suggested.status).toBe(201);
      const offered = suggested.body.steps.filter(
        (s) => s.status === 'suggested',
      );
      expect(offered).toHaveLength(3);
      for (const s of offered) {
        expect(s.stretch).toBe('tiny');
        expect(s.undo).toBeTruthy();
        expect(s.smaller).toBeTruthy();
      }
      expect(suggested.body.guidance?.notYet[0]?.move).toBe('Resigning');
      // Money did not answer: the dream still works, without a safety net figure.
      const context = await json<{
        areas: { area: string; reachable: boolean }[];
      }>('GET', `/dreams/${id}/context`);
      expect(
        context.body.areas.find((a) => a.area === 'money')?.reachable,
      ).toBe(false);

      // Choosing a step starts the dream, and its date goes to the Agenda.
      const pick = offered[0]!;
      expect(
        (await json('PUT', `/steps/${pick.id}/status`, { status: 'chosen' }))
          .status,
      ).toBe(204);
      await json('PUT', `/steps/${pick.id}`, {
        dueDate: isoAddDays(today(), 5),
      });
      const deadlines = await json<DeadlineDto[]>('GET', '/deadlines');
      expect(deadlines.body.some((d) => d.title === pick.title)).toBe(true);

      // Two hard check-ins: the next round is tiny, short, and carries a care note.
      expect(
        (
          await json('POST', '/check-ins', {
            dreamId: id,
            stepId: pick.id,
            outcome: 'done',
            feeling: 2,
            nextPace: 'smaller',
          })
        ).status,
      ).toBe(204);
      const skip = offered[1]!;
      await json('POST', '/check-ins', {
        dreamId: id,
        stepId: skip.id,
        outcome: 'skipped',
        feeling: 1,
        note: 'Too much this week.',
      });
      overview = await json<DreamsOverviewDto>('GET', '/overview');
      dream = overview.body.dreams.find((d) => d.id === id)!;
      expect(dream.status).toBe('moving');
      expect(dream.doneSteps).toBe(1);
      expect(dream.reach).toMatchObject({
        heavy: true,
        count: 2,
        maxStretch: 'tiny',
      });
      expect(dream.checkIns[0]?.stepTitle).toBe(skip.title);

      const slower = await json<DreamDto>(
        'POST',
        `/dreams/${id}/suggestions`,
        {},
      );
      const next = slower.body.steps.filter((s) => s.status === 'suggested');
      expect(next).toHaveLength(2);
      // The step you set aside comes back smaller, first.
      expect(next[0]?.title).not.toBe(skip.title);
      expect(slower.body.guidance?.care).toBeTruthy();

      const attention = await json<LifeAttentionDto>('GET', '/attention');
      expect(attention.body.expired).toBe(0);
    });

    it('refuses a check-in on a step of another dream', async () => {
      const a = await json<{ id: string }>('POST', '/dreams', {
        title: 'A',
        area: 'travel',
      });
      const b = await json<{ id: string }>('POST', '/dreams', {
        title: 'B',
        area: 'travel',
      });
      dreamIds.push(a.body.id, b.body.id);
      const step = await json<{ id: string }>('POST', '/steps', {
        dreamId: a.body.id,
        title: 'Look at one place',
      });
      const wrong = await json('POST', '/check-ins', {
        dreamId: b.body.id,
        stepId: step.body.id,
        outcome: 'done',
        feeling: 4,
      });
      expect(wrong.status).toBe(404);
    });

    it('keeps habits with their ticks and streak, and one review a week', async () => {
      const dream = await json<{ id: string }>('POST', '/dreams', {
        title: 'Run a 10 km race',
        area: 'fitness',
        measure: 'Under an hour',
        targetDate: isoAddDays(today(), 20),
      });
      dreamIds.push(dream.body.id);
      const habit = await json<{ id: string }>('POST', '/habits', {
        title: 'Run',
        dreamId: dream.body.id,
        perWeek: 1,
      });
      expect(habit.status).toBe(201);
      const day = today();
      expect(
        (
          await json('PUT', `/habits/${habit.body.id}/checks`, {
            date: day,
            done: true,
          })
        ).status,
      ).toBe(204);
      // Ticking twice is the same tick.
      await json('PUT', `/habits/${habit.body.id}/checks`, {
        date: day,
        done: true,
      });
      let overview = await json<DreamsOverviewDto>('GET', '/overview');
      const ran = overview.body.habits.find((h) => h.id === habit.body.id)!;
      expect(ran).toMatchObject({
        dreamId: dream.body.id,
        thisWeek: 1,
        streak: 1,
        checked: [day],
      });
      expect(
        overview.body.dreams.find((d) => d.id === dream.body.id),
      ).toMatchObject({ measure: 'Under an hour', daysLeft: 20, stuck: false });

      // The hoped-for date goes to the Agenda.
      const deadlines = await json<DeadlineDto[]>('GET', '/deadlines');
      expect(
        deadlines.body.some((d) => d.id.startsWith(`dream:${dream.body.id}:`)),
      ).toBe(true);

      await json('PUT', `/habits/${habit.body.id}/checks`, {
        date: day,
        done: false,
      });
      // A week long past, so a review of yours is never touched.
      const review = {
        weekStart: '2001-01-03',
        mood: 4,
        wins: 'Ran once',
        stuck: null,
        next: 'Run twice',
      };
      expect((await json('PUT', '/weekly-reviews', review)).status).toBe(204);
      expect(
        (await json('PUT', '/weekly-reviews', { ...review, mood: 5 })).status,
      ).toBe(204);
      // One review a week, filed under its Monday.
      const { rows } = await svc.pool.query<{ mood: number }>(
        "select mood from dreams.weekly_reviews where week_start = '2001-01-01'",
      );
      expect(rows).toEqual([{ mood: 5 }]);
      await svc.pool.query(
        "delete from dreams.weekly_reviews where week_start = '2001-01-01'",
      );
      overview = await json<DreamsOverviewDto>('GET', '/overview');
      expect(
        overview.body.habits.find((h) => h.id === habit.body.id)?.thisWeek,
      ).toBe(0);
      // Deleting the dream keeps the habit, now just for you.
      await json('DELETE', `/dreams/${dream.body.id}`);
      overview = await json<DreamsOverviewDto>('GET', '/overview');
      expect(
        overview.body.habits.find((h) => h.id === habit.body.id)?.dreamId,
      ).toBeNull();
      await json('DELETE', `/habits/${habit.body.id}`);
    });
  },
);
