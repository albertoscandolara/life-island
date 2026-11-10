import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import { createServiceDb, type ServiceDb } from '@life-island/be-common';
import type {
  StudiesAttentionDto,
  StudiesOverviewDto,
  StudyPlanDto,
} from '@life-island/contracts';
import { createApp } from './bootstrap.js';
import { loadConfig } from './config.js';
import { localToday } from './studies/studies.service.js';

// Needs the compose stack: `npm run infra:up`, then `npm run test:integration`.
const configured = !!process.env['STUDIES_DATABASE_URL'];

describe.skipIf(!configured)(
  'Studies (platforms, paths, courses, exams, sessions, reminders and the coach over HTTP)',
  () => {
    let app: INestApplication;
    let base: string;
    let svc: ServiceDb;
    const run = Math.random().toString(36).slice(2, 7).toUpperCase();
    const created: { table: string; id: string }[] = [];

    const json = async <T>(
      method: string,
      path: string,
      body?: unknown,
    ): Promise<{ status: number; body: T }> => {
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
      // No key: the coach writes with the offline rules.
      const config = { ...loadConfig(), port: 0, anthropicApiKey: null };
      app = await createApp(config, { events: false });
      await app.listen(0);
      base = (await app.getUrl()).replace('[::1]', 'localhost');
      svc = createServiceDb({
        connectionString: config.databaseUrl,
        schema: 'studies',
      });
      await svc.pool.query(
        "delete from studies.path_progress where path_id in ('ai-coding', '3d')",
      );
      await svc.pool.query(
        "delete from studies.step_progress where path_id in ('ai-coding', '3d')",
      );
    });

    afterAll(async () => {
      for (const { table, id } of created.reverse())
        await svc?.pool.query(`delete from studies.${table} where id = $1`, [
          id,
        ]);
      await svc?.pool.query(
        "delete from studies.step_progress where path_id in ('ai-coding', '3d')",
      );
      await svc?.pool.query(
        "delete from studies.path_progress where path_id in ('ai-coding', '3d')",
      );
      await svc?.close();
      await app?.close();
    });

    it('keeps a subscription platform and warns before it renews', async () => {
      const today = localToday();
      const renews = new Date(Date.parse(`${today}T00:00:00Z`) + 5 * 86_400_000)
        .toISOString()
        .slice(0, 10);
      const added = await json<{ id: string }>('POST', '/platforms', {
        name: `Frontend Masters ${run}`,
        url: 'https://frontendmasters.com/',
        plan: 'subscription',
        price: 39,
        billingPeriod: 'month',
        renewsOn: renews,
        topics: ['frameworks', 'frameworks'],
      });
      expect(added.status).toBe(201);
      created.push({ table: 'training_platforms', id: added.body.id });

      const bad = await json('POST', '/platforms', {
        name: 'Bad',
        url: 'javascript:alert(1)',
      });
      expect(bad.status).toBe(400);

      expect(
        (await json('POST', `/platforms/${added.body.id}/opened`)).status,
      ).toBe(204);

      const { body } = await json<StudiesOverviewDto>('GET', '/overview');
      const platform = body.platforms.find((p) => p.id === added.body.id)!;
      expect(platform.yearlyCost).toBe(468);
      expect(platform.topics).toEqual(['frameworks']);
      expect(platform.lastOpenedAt).not.toBeNull();
      expect(
        body.reminders.some(
          (r) => r.kind === 'subscription' && r.refId === added.body.id,
        ),
      ).toBe(true);
      const attention = await json<StudiesAttentionDto>('GET', '/attention');
      expect(attention.body.expiring).toBeGreaterThan(0);
    });

    it('follows a path, logs a session on a step and moves the step to done', async () => {
      const step = 'ai-coding.foundations.llm-basics';
      const session = await json<{ id: string }>('POST', '/sessions', {
        date: localToday(),
        minutes: 50,
        stepId: step,
        note: `run ${run}`,
      });
      expect(session.status).toBe(201);
      created.push({ table: 'study_sessions', id: session.body.id });

      let { body } = await json<StudiesOverviewDto>('GET', '/overview');
      let ai = body.paths.find((p) => p.pathId === 'ai-coding')!;
      expect(ai.status).toBe('following');
      expect(ai.steps[0]).toMatchObject({ status: 'doing', minutes: 50 });
      expect(body.sessions.find((s) => s.id === session.body.id)?.topic).toBe(
        'ai',
      );
      expect(body.stats.weekMinutes).toBeGreaterThanOrEqual(50);

      expect(
        (await json('PUT', `/steps/${step}`, { status: 'done', notes: 'ok' }))
          .status,
      ).toBe(204);
      expect(
        (
          await json('PUT', '/paths/ai-coding', {
            status: 'following',
            targetOn: '2027-06-30',
          })
        ).status,
      ).toBe(204);
      ({ body } = await json<StudiesOverviewDto>('GET', '/overview'));
      ai = body.paths.find((p) => p.pathId === 'ai-coding')!;
      expect(ai.doneSteps).toBe(1);
      expect(ai.targetOn).toBe('2027-06-30');
      expect(ai.nextStepId).toBe('ai-coding.foundations.ai-fluency');

      expect(
        (await json('PUT', '/steps/nope.nope.nope', { status: 'done' })).status,
      ).toBe(404);
      expect(
        (await json('PUT', '/paths/cooking', { status: 'following' })).status,
      ).toBe(404);
      expect(
        (await json('PUT', '/paths/3d', { status: 'paused' })).status,
      ).toBe(204);
      expect((await json('PUT', '/paths/3d', { status: null })).status).toBe(
        204,
      );
    });

    it('tracks a course on a platform step and an exam', async () => {
      const course = await json<{ id: string }>('POST', '/courses', {
        title: `Claude Code in Action ${run}`,
        url: 'https://anthropic.skilljar.com/',
        stepId: 'ai-coding.daily.claude-code',
        status: 'completed',
        cost: 0,
      });
      expect(course.status).toBe(201);
      created.push({ table: 'courses', id: course.body.id });
      const exam = await json<{ id: string }>('POST', '/certifications', {
        name: `CKAD ${run}`,
        topic: 'infrastructure',
        status: 'planned',
        cost: 395,
      });
      created.push({ table: 'certifications', id: exam.body.id });

      const { body } = await json<StudiesOverviewDto>('GET', '/overview');
      const c = body.courses.find((x) => x.id === course.body.id)!;
      expect(c).toMatchObject({
        topic: 'ai',
        progress: 100,
        status: 'completed',
      });
      expect(c.completedOn).toBe(localToday());
      expect(body.certifications.some((x) => x.id === exam.body.id)).toBe(true);
      expect(
        (
          await json('POST', '/courses', {
            title: 'X',
            stepId: 'no.such.step',
          })
        ).status,
      ).toBe(400);
    });

    it('writes a study plan with the offline rules, keeps it and deletes it', async () => {
      const plan = await json<StudyPlanDto>('POST', '/plans', { hours: 3 });
      expect(plan.status).toBe(201);
      expect(plan.body.source).toBe('offline');
      expect(plan.body.output.focus.length).toBeGreaterThan(0);
      const { body } = await json<StudiesOverviewDto>('GET', '/overview');
      expect(body.plans[0].id).toBe(plan.body.id);
      expect(body.aiCoach).toBe(false);
      expect((await json('DELETE', `/plans/${plan.body.id}`)).status).toBe(204);
    });
  },
);
