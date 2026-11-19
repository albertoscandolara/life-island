import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import { createServer, type Server } from 'node:http';
import { randomUUID } from 'node:crypto';
import { createServiceDb, type ServiceDb } from '@life-island/be-common';
import type {
  MovementAttachmentDto,
  MoneyOverviewDto,
} from '@life-island/contracts';
import { createApp } from './bootstrap.js';
import { loadConfig } from './config.js';
import { today } from './money/money.service.js';

// Needs the compose stack: `npm run infra:up`, then `npm run test:integration`.
const configured = !!process.env['MONEY_DATABASE_URL'];

/** svc-ingestion as Money sees it: create, send the bytes, complete, preview. */
function fakeIngestion() {
  const files = new Map<string, { type: string; data: Buffer }>();
  const types = new Map<string, string>();
  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      const body = Buffer.concat(chunks);
      const [, , id, action] = (req.url ?? '').split('/');
      if (req.method === 'POST' && !id) {
        const uploadId = randomUUID();
        types.set(uploadId, JSON.parse(body.toString()).mimeType);
        res.writeHead(201, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ uploadId }));
        return;
      }
      if (req.method === 'PUT' && action === 'file') {
        files.set(id, { type: types.get(id) ?? '', data: body });
        res.writeHead(204);
        res.end();
        return;
      }
      if (req.method === 'POST' && action === 'complete') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ upload: { id }, duplicate: false }));
        return;
      }
      const file = files.get(id);
      if (req.method === 'GET' && action === 'preview' && file) {
        res.writeHead(200, { 'content-type': file.type });
        res.end(file.data);
        return;
      }
      res.writeHead(404);
      res.end();
    });
  });
  return { server, files };
}

describe.skipIf(!configured)(
  'Money receipts (files, notes, parts and channels over HTTP)',
  () => {
    let app: INestApplication;
    let base: string;
    let svc: ServiceDb;
    let ingestion: ReturnType<typeof fakeIngestion>;
    let accountId = '';
    let movementId = '';

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
      ingestion = fakeIngestion();
      await new Promise<void>((resolve) => ingestion.server.listen(0, resolve));
      const address = ingestion.server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      const config = {
        ...loadConfig(),
        port: 0,
        anthropicApiKey: null,
        ingestionUrl: `http://localhost:${port}`,
      };
      app = await createApp(config, { events: false });
      await app.listen(0);
      base = (await app.getUrl()).replace('[::1]', 'localhost');
      svc = createServiceDb({
        connectionString: config.databaseUrl,
        schema: 'money',
      });
    });

    afterAll(async () => {
      if (accountId)
        await svc?.pool.query('delete from money.accounts where id = $1', [
          accountId,
        ]);
      await svc?.close();
      await app?.close();
      await new Promise((resolve) =>
        (ingestion?.server as Server)?.close(resolve),
      );
    });

    it('files a receipt with a movement, splits it and says it was online', async () => {
      const day = today();
      accountId = (
        await json<{ id: string }>('POST', '/accounts', {
          name: 'Receipts test card',
          kind: 'card',
          openingDate: `${day.slice(0, 7)}-01`,
        })
      ).body.id;
      const created = await json<{ id: string }>('POST', '/transactions', {
        accountId,
        date: day,
        amount: -192.75,
        description: 'AMAZON PAYMENTS EUROPE',
        category: 'groceries',
      });
      expect(created.status).toBe(201);
      movementId = created.body.id;

      const form = new FormData();
      form.append(
        'files',
        new Blob([Buffer.from('fake png')], { type: 'image/png' }),
        'order.png',
      );
      const attached = await fetch(
        `${base}/transactions/${movementId}/attachments`,
        { method: 'POST', body: form },
      );
      expect(attached.status).toBe(201);
      const [attachment] = (await attached.json()) as MovementAttachmentDto[];
      expect(attachment).toMatchObject({
        name: 'order.png',
        contentType: 'image/png',
      });
      expect(ingestion.files.get(attachment.uploadId)?.data.toString()).toBe(
        'fake png',
      );

      const preview = await fetch(
        `${base}/attachments/${attachment.id}/preview`,
      );
      expect(preview.headers.get('content-type')).toBe('image/png');
      expect(await preview.text()).toBe('fake png');

      const tooMuch = await json('PUT', `/transactions/${movementId}`, {
        splits: [{ category: 'shopping', amount: 200 }],
      });
      expect(tooMuch.status).toBe(400);
      expect(
        (
          await json('PUT', `/transactions/${movementId}`, {
            notes: 'Detergent, toilet paper, placemats €27.99',
            splits: [{ category: 'shopping', amount: 27.99 }],
            channel: 'online',
          })
        ).status,
      ).toBe(204);

      const overview = (await json<MoneyOverviewDto>('GET', '/overview')).body;
      const movement = overview.transactions.find((t) => t.id === movementId);
      expect(movement).toMatchObject({
        notes: 'Detergent, toilet paper, placemats €27.99',
        splits: [{ category: 'shopping', amount: 27.99 }],
        channel: 'online',
      });
      expect(movement?.attachments.map((a) => a.id)).toEqual([attachment.id]);
      const month = overview.months.at(-1);
      expect(month?.spendingBy.shopping).toBeGreaterThanOrEqual(27.99);
      expect(overview.purchaseChannels.at(-1)?.online).toBeGreaterThanOrEqual(
        192.75,
      );
      expect(overview.aiReceipts).toBe(false);
    });

    it('says the reader is off without a key, and forgets a receipt', async () => {
      const read = await json<{ message: string }>(
        'POST',
        `/transactions/${movementId}/read`,
      );
      expect(read.status).toBe(503);
      expect(read.body.message).toMatch(/Settings → AI tools/);

      const overview = (await json<MoneyOverviewDto>('GET', '/overview')).body;
      const [attachment] =
        overview.transactions.find((t) => t.id === movementId)?.attachments ??
        [];
      expect(
        (
          await json(
            'DELETE',
            `/transactions/${movementId}/attachments/${attachment.id}`,
          )
        ).status,
      ).toBe(204);
      expect(
        (await json('GET', `/attachments/${attachment.id}/preview`)).status,
      ).toBe(404);
    });

    it('refuses files that are not receipts', async () => {
      const form = new FormData();
      form.append(
        'files',
        new Blob(['hello'], { type: 'text/plain' }),
        'note.txt',
      );
      const response = await fetch(
        `${base}/transactions/${movementId}/attachments`,
        { method: 'POST', body: form },
      );
      expect(response.status).toBe(400);
    });
  },
);
