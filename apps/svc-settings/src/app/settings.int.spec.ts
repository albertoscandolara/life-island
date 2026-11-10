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
  },
);
