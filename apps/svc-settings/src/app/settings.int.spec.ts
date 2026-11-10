import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import {
  createServiceDb,
  processOnce,
  type ServiceDb,
} from '@life-island/be-common';
import {
  AI_TOOL_DESCRIBED_EVENT,
  AI_TOOL_USED_EVENT,
  SETTING_CHANGED_EVENT,
  type EventEnvelope,
  type SettingsOverviewDto,
} from '@life-island/contracts';
import { randomUUID } from 'node:crypto';
import { createApp } from './bootstrap.js';
import { loadConfig } from './config.js';
import { SettingsService } from './settings/settings.service.js';

// Needs the compose stack: `npm run infra:up`, then `npm run test:integration`.
const configured = !!process.env['SETTINGS_DATABASE_URL'];

describe.skipIf(!configured)(
  'Settings (switches, requests and uses over HTTP)',
  () => {
    let app: INestApplication;
    let base: string;
    let svc: ServiceDb;
    let settings: SettingsService;

    beforeAll(async () => {
      const config = { ...loadConfig(), port: 0 };
      app = await createApp(config, { events: false });
      await app.listen(0);
      base = (await app.getUrl()).replace('[::1]', 'localhost');
      svc = createServiceDb({
        connectionString: config.databaseUrl,
        schema: 'settings',
      });
      settings = app.get(SettingsService);
    });

    afterAll(async () => {
      await fetch(`${base}/ai-tools/work.market-check`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ enabled: true }),
      });
      await svc?.close();
      await app?.close();
    });

    async function overview(): Promise<SettingsOverviewDto> {
      return (
        await fetch(`${base}/overview`)
      ).json() as Promise<SettingsOverviewDto>;
    }

    function envelope(type: string, payload: unknown): EventEnvelope {
      return {
        id: randomUUID(),
        type,
        source: 'test',
        occurredAt: new Date().toISOString(),
        payload,
      };
    }

    it('turns a tool off and publishes the change through the outbox', async () => {
      const response = await fetch(`${base}/ai-tools/work.market-check`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ enabled: false }),
      });
      expect(response.status).toBe(204);
      const tool = (await overview()).tools.find(
        (t) => t.id === 'work.market-check',
      );
      expect(tool).toMatchObject({ enabled: false, active: false });
      const { rows } = await svc.pool.query<{
        payload: { key: string; value: boolean };
      }>(
        `select payload from settings.outbox where event_type = $1 order by created_at desc limit 1`,
        [SETTING_CHANGED_EVENT],
      );
      expect(rows[0].payload).toMatchObject({
        key: 'ai-tool.work.market-check',
        value: false,
      });
    });

    it('refuses unknown tools, unknown keys and wrong values', async () => {
      const put = (path: string, body: unknown) =>
        fetch(`${base}${path}`, {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        });
      expect((await put('/ai-tools/work.nope', { enabled: true })).status).toBe(
        400,
      );
      expect((await put('/settings/nope', { value: true })).status).toBe(400);
      expect((await put('/settings/ai.enabled', { value: 'yes' })).status).toBe(
        400,
      );
    });

    it('keeps the request a tool reports and counts each use once', async () => {
      const described = envelope(AI_TOOL_DESCRIBED_EVENT, {
        toolId: 'documents.reclassify',
        service: 'svc-parse-worker',
        available: true,
        promptVersion: 'test',
        describedAt: new Date().toISOString(),
        steps: [
          {
            stepId: 'reclassify',
            label: 'Match new categories',
            model: 'claude-haiku-5-5',
            effort: 'low',
            maxTokens: 2000,
            thinking: 'adaptive',
            tools: [],
            system: 'You keep a personal document archive…',
            userTemplate: '{document}',
            outputFormat: 'categoryMatch',
            promptCaching: false,
          },
        ],
      });
      await processOnce(svc.pool, svc.schema, described.id, (client) =>
        settings.applyDescribed(described, client),
      );
      const used = envelope(AI_TOOL_USED_EVENT, {
        toolId: 'documents.reclassify',
        service: 'svc-parse-worker',
        outcome: 'ok',
        usedAt: new Date().toISOString(),
        steps: [
          {
            stepId: 'reclassify',
            model: 'claude-haiku-5-5',
            inputTokens: 1_000_000,
            outputTokens: 0,
          },
        ],
      });
      const before = (await overview()).tools.find(
        (t) => t.id === 'documents.reclassify',
      )!;
      for (let i = 0; i < 2; i++)
        await processOnce(svc.pool, svc.schema, used.id, (client) =>
          settings.applyUsed(used, client),
        );
      const tool = (await overview()).tools.find(
        (t) => t.id === 'documents.reclassify',
      )!;
      expect(tool.request?.promptVersion).toBe('test');
      expect(tool.available).toBe(true);
      expect(tool.usage.uses).toBe(before.usage.uses + 1);
      expect(tool.recentUses[0].costUsd).toBeCloseTo(0.1);
    });

    const send = (method: string, path: string, body?: unknown) =>
      fetch(`${base}${path}`, {
        method,
        headers: { 'content-type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      });

    async function latestChange(key: string) {
      const { rows } = await svc.pool.query<{
        payload: { key: string; value: unknown };
      }>(
        `select payload from settings.outbox
          where event_type = $1 and payload->>'key' = $2
          order by created_at desc limit 1`,
        [SETTING_CHANGED_EVENT, key],
      );
      return rows[0]?.payload;
    }

    it('picks a model for a tool, and resets it to the service default', async () => {
      const key = 'ai-model.documents.classify';
      expect(
        (await send('PUT', `/settings/${key}`, { value: 'claude-opus-5-5' }))
          .status,
      ).toBe(204);
      let tool = (await overview()).tools.find(
        (t) => t.id === 'documents.classify',
      )!;
      expect(tool.models['classify']).toBe('claude-opus-5-5');
      expect(tool.customized).toBe(true);

      expect((await send('DELETE', `/settings/${key}`)).status).toBe(204);
      tool = (await overview()).tools.find(
        (t) => t.id === 'documents.classify',
      )!;
      expect(tool.modelOverride).toBeNull();
      expect(await latestChange(key)).toMatchObject({ key, value: null });
      expect((await send('DELETE', '/settings/nope')).status).toBe(400);
    });

    it('imports a backup all or nothing, and exports what you set', async () => {
      expect(
        (
          await send('PUT', '/settings', {
            values: {
              'people.warn-days.passport': 120,
              'documents.reading-time': '99:00',
            },
          })
        ).status,
      ).toBe(400);
      expect(
        (await (await send('GET', '/settings')).json())[
          'people.warn-days.passport'
        ],
      ).toBeUndefined();

      const imported = await send('PUT', '/settings', {
        values: {
          'people.warn-days.passport': 120,
          'documents.reading-time': '21:30',
        },
      });
      expect(await imported.json()).toEqual({ imported: 2 });
      const exported = await (await send('GET', '/settings')).json();
      expect(exported).toMatchObject({
        'people.warn-days.passport': 120,
        'documents.reading-time': '21:30',
      });
      expect(exported['ai.budget-reached']).toBeUndefined();
      await send('PUT', '/settings', {
        values: {
          'people.warn-days.passport': null,
          'documents.reading-time': null,
        },
      });
      expect(
        (await (await send('GET', '/settings')).json())[
          'people.warn-days.passport'
        ],
      ).toBeUndefined();
    });

    it('stops AI once the month reaches the budget, and lifts it when raised', async () => {
      const used = envelope(AI_TOOL_USED_EVENT, {
        toolId: 'work.career-feedback',
        service: 'svc-work',
        outcome: 'ok',
        usedAt: new Date().toISOString(),
        steps: [
          {
            stepId: 'feedback',
            model: 'claude-sonnet-5-5',
            inputTokens: 1_000_000,
            outputTokens: 0,
          },
        ],
      });
      await processOnce(svc.pool, svc.schema, used.id, (client) =>
        settings.applyUsed(used, client),
      );
      const spent = (await overview()).budget.spentUsd;
      expect(spent).toBeGreaterThanOrEqual(2);

      await send('PUT', '/settings/ai.budget-stop', { value: true });
      await send('PUT', '/settings/ai.monthly-budget-usd', { value: 1 });
      let current = await overview();
      expect(current.budget).toMatchObject({ reached: true, blocking: true });
      expect(current.tools.every((t) => !t.active)).toBe(true);
      expect(await latestChange('ai.budget-reached')).toMatchObject({
        value: true,
      });
      expect(
        current.spending[0].byTool['work.career-feedback'],
      ).toBeGreaterThan(0);

      await send('PUT', '/settings/ai.monthly-budget-usd', {
        value: Math.ceil(spent) + 100,
      });
      current = await overview();
      expect(current.budget.blocking).toBe(false);
      expect(await latestChange('ai.budget-reached')).toMatchObject({
        value: false,
      });
      await send('DELETE', '/settings/ai.monthly-budget-usd');
      await send('DELETE', '/settings/ai.budget-stop');
    });
  },
);
