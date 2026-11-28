import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import { createServiceDb, type ServiceDb } from '@life-island/be-common';
import { learningPath } from '@life-island/contracts';
import type {
  StudiesAttentionDto,
  StudiesOverviewDto,
  StudyPlanDto,
} from '@life-island/contracts';
import { createApp } from './bootstrap.js';
import { loadConfig } from './config.js';
import { ResourceScout } from './studies/resource-scout.js';
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
      const step = 'ai-coding.foundations.ai-fluency';
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
      expect(ai.nextStepId).toBe('ai-coding.foundations.prompting');

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
      // No key either for the path builder: it says so instead of drafting.
      expect(body.aiPathBuilder).toBe(false);
      const draft = await json<{ message: string }>('POST', '/paths/draft', {
        subject: 'Rust',
      });
      expect(draft.status).toBe(503);
      expect(draft.body.message).toContain('ANTHROPIC_API_KEY');
      expect(
        (await json('POST', '/paths/draft', { subject: 'x' })).status,
      ).toBe(400);
      expect((await json('DELETE', `/plans/${plan.body.id}`)).status).toBe(204);
    });

    it('keeps what the resource scout found: pin, dismiss, and an outline change you accept', async () => {
      const stage = 'foundations';
      const stepId = `ai-coding.${stage}.scout-test-${run.toLowerCase()}`;
      const [suggested, other] = (
        await svc.pool.query<{ id: string }>(
          `insert into studies.scout_resources (path_id, step_id, url, title, kind, why, status)
           values ('ai-coding', 'ai-coding.foundations.prompting', $1, 'Fresh guide', 'docs', 'Current.', 'suggested'),
                  ('ai-coding', 'ai-coding.foundations.prompting', $2, 'Old video', 'video', 'Popular.', 'suggested')
           returning id`,
          [
            `https://example.com/${run}/guide`,
            `https://example.com/${run}/video`,
          ],
        )
      ).rows;
      const [change] = (
        await svc.pool.query<{ id: string }>(
          `insert into studies.outline_changes (path_id, kind, stage_id, step_id, title, detail, outcome, step_kind, hours, reason)
           values ('ai-coding', 'add-step', $1, $2, 'Context engineering', 'What goes in the window.', 'You plan a context.', 'learn', 3, 'The field moved.')
           returning id`,
          [stage, stepId],
        )
      ).rows;
      created.push(
        { table: 'scout_resources', id: suggested.id },
        { table: 'scout_resources', id: other.id },
        { table: 'outline_changes', id: change.id },
      );

      let { body } = await json<StudiesOverviewDto>('GET', '/overview');
      expect(body.scout.ai).toBe(false);
      expect(body.scout.proposals.some((p) => p.id === change.id)).toBe(true);
      expect(
        body.scout.resources.find((r) => r.id === suggested.id)?.status,
      ).toBe('suggested');
      const before = body.paths.find(
        (p) => p.pathId === 'ai-coding',
      )!.totalSteps;

      expect(
        (
          await json('PUT', `/scout/resources/${suggested.id}`, {
            status: 'pinned',
          })
        ).status,
      ).toBe(204);
      expect(
        (
          await json('PUT', `/scout/resources/${other.id}`, {
            status: 'dismissed',
          })
        ).status,
      ).toBe(204);
      expect(
        (await json('PUT', `/scout/resources/${other.id}`, { status: 'maybe' }))
          .status,
      ).toBe(400);
      expect(
        (
          await json('PUT', `/scout/changes/${change.id}`, {
            decision: 'accepted',
          })
        ).status,
      ).toBe(204);
      expect(
        (
          await json('PUT', `/scout/changes/${change.id}`, {
            decision: 'declined',
          })
        ).status,
      ).toBe(409);

      ({ body } = await json<StudiesOverviewDto>('GET', '/overview'));
      expect(
        body.scout.resources.find((r) => r.id === suggested.id)?.status,
      ).toBe('pinned');
      expect(body.scout.resources.some((r) => r.id === other.id)).toBe(false);
      expect(body.scout.proposals.some((p) => p.id === change.id)).toBe(false);
      const steps = body.catalogue.find((p) => p.id === 'ai-coding')!.stages[0]
        .steps;
      expect(steps.at(-1)?.id).toBe(stepId);
      expect(body.paths.find((p) => p.pathId === 'ai-coding')!.totalSteps).toBe(
        before + 1,
      );
      // The new step takes progress like any other.
      expect(
        (await json('PUT', `/steps/${stepId}`, { status: 'doing' })).status,
      ).toBe(204);
      expect(
        (
          await json('PUT', '/steps/ai-coding.foundations.no-such-step', {
            status: 'doing',
          })
        ).status,
      ).toBe(404);
    });

    it('watches every path you follow, unless you stop it, and refreshes one with the scout on', async () => {
      expect(
        (await json('POST', '/scout/scans', { pathId: 'cooking' })).status,
      ).toBe(404);
      expect((await json('POST', '/scout/scans', {})).status).toBe(400);
      expect(
        (await json('PUT', '/paths/frameworks', { status: 'following' }))
          .status,
      ).toBe(204);
      let { body } = await json<StudiesOverviewDto>('GET', '/overview');
      let watch = body.scout.watched.find((w) => w.pathId === 'frameworks')!;
      expect(watch.watching).toBe(true);
      expect(watch.cadenceMonths).toBe(2);
      expect(watch.nextScanOn).not.toBeNull();
      expect(body.scout.monthlyScans).toBe(4);
      // Stop it for this path: still followed, no longer watched.
      expect(
        (
          await json('PUT', '/paths/frameworks', {
            status: 'following',
            watch: false,
          })
        ).status,
      ).toBe(204);
      ({ body } = await json<StudiesOverviewDto>('GET', '/overview'));
      watch = body.scout.watched.find((w) => w.pathId === 'frameworks')!;
      expect(watch.watching).toBe(false);
      expect(watch.nextScanOn).toBeNull();
      // No API key in this test: the scout cannot scan.
      expect(
        (await json('POST', '/scout/scans', { pathId: 'frameworks' })).status,
      ).toBe(503);
      expect((await json('DELETE', '/paths/frameworks')).status).toBe(204);
    });

    it('adds a curated path and one of your own, changes it and removes it', async () => {
      await json('DELETE', '/paths/finance');
      const { body: before } = await json<StudiesOverviewDto>(
        'GET',
        '/overview',
      );
      expect(before.templates.some((t) => t.id === 'finance')).toBe(true);
      expect(before.catalogue.some((p) => p.id === 'finance')).toBe(false);
      expect(
        (await json('POST', '/paths', { template: 'finance' })).status,
      ).toBe(201);
      expect(
        (await json('POST', '/paths', { template: 'finance' })).status,
      ).toBe(409);

      const outline = {
        name: `Public speaking ${run}`,
        emblem: '🎤',
        topic: 'leadership',
        stages: [
          {
            title: 'Short demos',
            steps: [{ title: 'A 5 minute demo', kind: 'practice', hours: 2 }],
          },
        ],
      };
      const added = await json<{ id: string }>('POST', '/paths', { outline });
      expect(added.status).toBe(201);
      const id = added.body.id;
      expect(id).toBe(`public-speaking-${run.toLowerCase()}`);
      const stepId = `${id}.short-demos.a-5-minute-demo`;
      expect(
        (await json('PUT', `/steps/${stepId}`, { status: 'done' })).status,
      ).toBe(204);

      // Rename the step and add one: the kept step keeps its progress.
      expect(
        (
          await json('PUT', `/paths/${id}/outline`, {
            ...outline,
            stages: [
              {
                id: 'short-demos',
                title: 'Short demos',
                steps: [
                  { id: stepId, title: 'A demo', kind: 'practice', hours: 2 },
                  { title: 'A team talk', kind: 'build', hours: 4 },
                ],
              },
            ],
          })
        ).status,
      ).toBe(204);
      let { body } = await json<StudiesOverviewDto>('GET', '/overview');
      const mine = body.paths.find((p) => p.pathId === id)!;
      expect(mine.status).toBe('following');
      expect(mine.totalSteps).toBe(2);
      expect(mine.doneSteps).toBe(1);
      expect(
        body.catalogue.find((p) => p.id === id)!.stages[0].steps[0].title,
      ).toBe('A demo');
      expect(body.templates.some((t) => t.id === 'finance')).toBe(false);

      expect((await json('DELETE', `/paths/${id}`)).status).toBe(204);
      expect((await json('DELETE', '/paths/finance')).status).toBe(204);
      expect((await json('DELETE', `/paths/${id}`)).status).toBe(404);
      ({ body } = await json<StudiesOverviewDto>('GET', '/overview'));
      expect(body.catalogue.some((p) => p.id === id)).toBe(false);
      expect(body.templates.some((t) => t.id === 'finance')).toBe(true);
    });

    it('writes a scan: new suggestions replace the old ones, pinned ones are checked', async () => {
      const scout = app.get(ResourceScout);
      scout.linkAlive = async (url: string) => !url.includes('/gone');
      const step = 'ai-coding.foundations.ai-fluency';
      await svc.pool.query(
        `delete from studies.scout_resources where step_id = $1`,
        [step],
      );
      const pinned = `https://example.com/${run}/pinned`;
      await svc.pool.query(
        `insert into studies.scout_resources (path_id, step_id, url, title, kind, why, status)
         values ('ai-coding', $1, $2, 'Pinned', 'docs', 'Mine.', 'pinned'),
                ('ai-coding', $1, $3, 'Stale suggestion', 'docs', 'Old.', 'suggested')`,
        [step, pinned, `https://example.com/${run}/stale`],
      );
      const scope = await scout.scope(learningPath('ai-coding')!);
      const result = await scout.save(
        '00000000-0000-4000-8000-000000000000',
        scope,
        {
          steps: [
            {
              stepId: step,
              pace: 'fast',
              resources: [
                {
                  title: 'Fresh',
                  url: `https://example.com/${run}/fresh`,
                  kind: 'course',
                  publishedOn: '2026-10',
                  free: true,
                  why: 'New.',
                },
                {
                  title: 'Gone',
                  url: `https://example.com/${run}/gone`,
                  kind: 'article',
                  publishedOn: null,
                  free: true,
                  why: 'Dead.',
                },
              ],
            },
          ],
          pinned: [
            { url: pinned, outdated: true, reason: 'Replaced by version 2.' },
          ],
          outline: [],
        },
      );
      expect(result).toMatchObject({ found: 1, flagged: 1, proposed: 0 });
      const { rows } = await svc.pool.query<{
        title: string;
        status: string;
        outdated: string | null;
      }>(
        'select title, status, outdated from studies.scout_resources where step_id = $1 order by title',
        [step],
      );
      expect(rows).toEqual([
        { title: 'Fresh', status: 'suggested', outdated: null },
        {
          title: 'Pinned',
          status: 'pinned',
          outdated: 'Replaced by version 2.',
        },
      ]);
      const { body } = await json<StudiesOverviewDto>('GET', '/overview');
      expect(body.scout.paces[step]).toBe('fast');
      await svc.pool.query(
        'delete from studies.scout_resources where step_id = $1',
        [step],
      );
      await svc.pool.query(
        'delete from studies.scout_steps where step_id = $1',
        [step],
      );
    });
  },
);
