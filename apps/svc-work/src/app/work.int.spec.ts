import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import {
  createServiceDb,
  processOnce,
  type ServiceDb,
} from '@life-island/be-common';
import type {
  CareerFeedbackDto,
  EventEnvelope,
  PendingWorkReviewDto,
  WorkOverviewDto,
} from '@life-island/contracts';
import { randomUUID } from 'node:crypto';
import { createApp } from './bootstrap.js';
import { loadConfig } from './config.js';
import { applyDocumentEvent } from './documents/document-events.handler.js';

// Needs the compose stack: `npm run infra:up`, then `npm run test:integration`.
const configured = !!process.env['WORK_DATABASE_URL'];

describe.skipIf(!configured)(
  'Work (payslips → workplaces, review, timeline, statistics, platforms and feedback over HTTP)',
  () => {
    let app: INestApplication;
    let base: string;
    let svc: ServiceDb;
    // An employer of this run only, so it never matches another run's workplaces.
    const run = Math.random().toString(36).slice(2, 7).toUpperCase();
    const employer = `ESEMPIO ${run} S.R.L.`;
    const taxCode = `0${String(Date.now()).slice(-10)}`;
    const uploads: string[] = [];
    const platforms: string[] = [];

    beforeAll(async () => {
      // No key: the feedback comes from the offline rules.
      const config = { ...loadConfig(), port: 0, anthropicApiKey: null };
      app = await createApp(config, { events: false });
      await app.listen(0);
      base = (await app.getUrl()).replace('[::1]', 'localhost');
      svc = createServiceDb({
        connectionString: config.databaseUrl,
        schema: 'work',
      });
      // The categories of svc-ingestion's migrations 0007 and 0014.
      for (const id of [
        'PAYSLIP',
        'PERFORMANCE_REVIEW',
        'EMPLOYMENT_CONTRACT',
        'WORK',
      ])
        await deliver('category.changed@1', {
          id,
          title: id,
          parentId: null,
          dimension: id === 'WORK' ? 'SUBJECT' : 'DOCUMENT_TYPE',
          deleted: false,
          changedAt: new Date().toISOString(),
        });
    });

    afterAll(async () => {
      if (uploads.length) {
        await svc?.pool.query(
          'delete from work.reviews where upload_id = any($1)',
          [uploads],
        );
        await svc?.pool.query(
          'delete from work.documents where upload_id = any($1)',
          [uploads],
        );
      }
      await svc?.pool.query(
        "delete from work.workplaces where values->>'employerName' = $1",
        [employer],
      );
      if (platforms.length)
        await svc?.pool.query(
          'delete from work.hiring_platforms where id = any($1)',
          [platforms],
        );
      await svc?.close();
      await app?.close();
    });

    async function deliver(type: string, payload: unknown) {
      const event: EventEnvelope = {
        id: randomUUID(),
        type,
        source: 'test',
        occurredAt: new Date().toISOString(),
        payload,
      };
      await processOnce(svc.pool, 'work', event.id, (client) =>
        applyDocumentEvent(event, client),
      );
    }

    async function upload(
      categories: string[],
      fields: Record<string, string | number | boolean | null>,
    ) {
      const uploadId = randomUUID();
      uploads.push(uploadId);
      await deliver('upload.updated@1', {
        uploadId,
        title: `${categories[0]} ${run}`,
        description: null,
        originalFilename: 'scan.pdf',
        fileFormat: 'PDF',
        uploadedAt: new Date().toISOString(),
        categories,
        suggestedCategories: [],
        fields,
        updatedAt: new Date().toISOString(),
      });
      return uploadId;
    }

    // Anonymized payslip fields, made-up amounts.
    const payslip = (
      month: string,
      extra: Record<string, string | number> = {},
    ) =>
      upload(['INCOME', 'PAYSLIP', 'WORK'], {
        employer,
        employer_tax_code: taxCode,
        employee_code: '12345',
        hire_date: '2020-03-01',
        pay_period: `2026-${month}-01/2026-${month}-28`,
        gross_pay: 2350,
        total_deductions: 610,
        net_pay: 1740,
        job_level: 'B1',
        monthly_salary: 2350,
        ...extra,
      });

    const json = async <T>(response: Response): Promise<T> => {
      if (!response.ok)
        throw new Error(`${response.status}: ${await response.text()}`);
      return (await response.json()) as T;
    };
    const send = (method: string, path: string, body?: unknown) =>
      fetch(`${base}${path}`, {
        method,
        headers: { 'content-type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    const overview = async () =>
      json<WorkOverviewDto>(await send('GET', '/overview'));
    const review = async (uploadId: string) =>
      (await overview()).reviews.find(
        (r) => r.uploadId === uploadId,
      ) as PendingWorkReviewDto;

    let workplaceId: string;

    it('suggests a new workplace from a payslip of an employer you do not have', async () => {
      const april = await payslip('04');
      const pending = await review(april);
      expect(pending).toMatchObject({
        type: 'PAYSLIP',
        workplaceId: null,
        match: 'none',
        employerName: employer,
        employerTaxCode: taxCode,
      });
      expect(
        pending.changes.find((c) => c.field === 'monthlySalary'),
      ).toMatchObject({ proposed: 2350, suggestion: 'accept' });

      expect(
        (
          await send('POST', `/reviews/${april}/approve`, {
            workplaceId: null,
            label: 'Esempio',
          })
        ).status,
      ).toBe(204);
      const created = (await overview()).workplaces.find(
        (w) => w.values.employerName === employer,
      );
      expect(created).toMatchObject({
        label: 'Esempio',
        status: 'current',
        latestPeriod: '2026-04',
        values: expect.objectContaining({
          level: 'B1',
          hireDate: '2020-03-01',
        }),
      });
      workplaceId = created!.id;
    });

    it('matches the next payslip by tax code and proposes the rise for review', async () => {
      const june = await payslip('06', {
        employer: 'Esempio lavori', // printed differently: the tax code still matches
        monthly_salary: 2480,
        gross_pay: 2600,
        net_pay: 1930,
      });
      const pending = await review(june);
      expect(pending).toMatchObject({ workplaceId, match: 'tax_code' });
      const salary = pending.changes.find((c) => c.field === 'monthlySalary');
      expect(salary).toMatchObject({
        current: 2350,
        proposed: 2480,
        suggestion: 'accept',
      });

      await send('POST', `/reviews/${june}/approve`, {
        workplaceId,
        accept: ['monthlySalary'],
      });
      const all = await overview();
      const workplace = all.workplaces.find((w) => w.id === workplaceId)!;
      expect(workplace.values.monthlySalary).toBe(2480);
      // The name you kept stays: only what you accepted changed.
      expect(workplace.values.employerName).toBe(employer);
      expect(
        all.timeline
          .filter((e) => e.workplaceId === workplaceId)
          .map((e) => e.kind),
      ).toEqual(['salary_rise', 'hired']);
    });

    it('suggests keeping your values for an older payslip, and counts the gap', async () => {
      const march = await payslip('03', {
        job_level: 'C3',
        monthly_salary: 2200,
      });
      const pending = await review(march);
      expect(pending.outdated).toBe(true);
      expect(pending.changes.find((c) => c.field === 'level')).toMatchObject({
        suggestion: 'keep_current',
      });
      await send('POST', `/reviews/${march}/approve`, { workplaceId });
      const { stats, timeline, workplaces } = await overview();
      expect(workplaces.find((w) => w.id === workplaceId)?.values.level).toBe(
        'B1',
      );
      expect(
        timeline.find(
          (e) => e.workplaceId === workplaceId && e.kind === 'promotion',
        ),
      ).toMatchObject({ title: 'Level C3 → B1', date: '2026-04-01' });
      expect(stats.missingMonths).toContain('2026-05');
    });

    it('rejects a document and reopens it', async () => {
      const other = await payslip('07');
      expect((await send('POST', `/reviews/${other}/reject`)).status).toBe(204);
      expect((await overview()).rejected.map((r) => r.uploadId)).toContain(
        other,
      );
      expect((await send('POST', `/reviews/${other}/reopen`)).status).toBe(204);
      expect(await review(other)).toBeDefined();
    });

    it('keeps the events you add, and your hiring platforms', async () => {
      const event = await json<{ id: string }>(
        await send('POST', '/events', {
          date: '2026-05-20',
          kind: 'certification',
          title: `Certification ${run}`,
          workplaceId,
        }),
      );
      const created = await json<{ id: string }>(
        await send('POST', '/platforms', {
          name: 'LinkedIn',
          url: 'https://www.linkedin.com/jobs/',
          profileUpdatedAt: '2025-01-10',
        }),
      );
      platforms.push(created.id);
      const bad = await send('POST', '/platforms', {
        name: 'Nope',
        url: 'javascript:alert(1)',
      });
      expect(bad.status).toBe(400);

      const all = await overview();
      expect(all.timeline.find((e) => e.id === event.id)).toMatchObject({
        kind: 'certification',
        source: 'manual',
        workplaceName: 'Esempio',
      });
      expect(all.platforms.find((p) => p.id === created.id)).toMatchObject({
        status: 'active',
        stale: true,
      });
      await send('DELETE', `/events/${event.id}`);
      expect((await overview()).timeline.some((e) => e.id === event.id)).toBe(
        false,
      );
    });

    it('tracks a job application from sent to offer, and audits the payslips', async () => {
      const created = await json<{ id: string }>(
        await send('POST', '/applications', {
          company: `Nuova ${run}`,
          role: 'Process engineer',
          status: 'applied',
          appliedAt: '2026-10-01',
          ralMin: 35000,
          ralMax: 40000,
        }),
      );
      const bad = await send('POST', '/applications', {
        company: 'Nope',
        role: 'Nope',
        url: 'javascript:alert(1)',
      });
      expect(bad.status).toBe(400);
      expect(
        (
          await send('PUT', `/applications/${created.id}`, {
            company: `Nuova ${run}`,
            role: 'Process engineer',
            status: 'offer',
            appliedAt: '2026-10-01',
            offerRal: 38500,
            offerMonths: 14,
          })
        ).status,
      ).toBe(204);

      const all = await overview();
      const mine = all.applications.find((a) => a.id === created.id);
      expect(mine).toMatchObject({ status: 'offer', offerRal: 38500 });
      expect(mine?.history.map((h) => h.status)).toEqual(['applied', 'offer']);
      expect(all.jobSearch.offers).toBeGreaterThanOrEqual(1);
      expect(all.audit.checkedPayslips).toBeGreaterThan(0);
      expect(all.tfr.years.length).toBeGreaterThan(0);

      expect((await send('DELETE', `/applications/${created.id}`)).status).toBe(
        204,
      );
      expect(
        (await overview()).applications.some((a) => a.id === created.id),
      ).toBe(false);
    });

    it('writes and keeps a career feedback, offline without a key', async () => {
      const feedback = await json<CareerFeedbackDto>(
        await send('POST', '/feedback', {}),
      );
      expect(feedback).toMatchObject({ source: 'offline', model: null });
      expect(feedback.documentsUsed).toBeGreaterThanOrEqual(3);
      expect(feedback.suggestions.length).toBeGreaterThan(0);
      const all = await overview();
      expect(all.aiFeedback).toBe(false);
      expect(all.feedback[0].id).toBe(feedback.id);
      await send('DELETE', `/feedback/${feedback.id}`);
    });

    it('removes a workplace and sends its documents back to review', async () => {
      expect((await send('DELETE', `/workplaces/${workplaceId}`)).status).toBe(
        204,
      );
      const all = await overview();
      expect(all.workplaces.some((w) => w.id === workplaceId)).toBe(false);
      expect(
        all.reviews.filter((r) => uploads.includes(r.uploadId)).length,
      ).toBe(4);
    });
  },
);
