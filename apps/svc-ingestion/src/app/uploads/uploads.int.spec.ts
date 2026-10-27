import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import { createServiceDb, type ServiceDb } from '@life-island/be-common';
import type {
  CompleteUploadResponse,
  CreateUploadResponse,
  Page,
  UploadDto,
} from '@life-island/contracts';
import { randomUUID } from 'node:crypto';
import { createApp } from '../bootstrap.js';
import { loadConfig } from '../config.js';

// Needs the compose stack: `npm run infra:up`, then `npm run test:integration`.
const configured =
  !!process.env['INGESTION_DATABASE_URL'] && !!process.env['S3_ENDPOINT'];

describe.skipIf(!configured)('upload flow (HTTP → storage → database)', () => {
  let app: INestApplication;
  let base: string;
  let svc: ServiceDb;

  beforeAll(async () => {
    const config = { ...loadConfig(), port: 0, storageCorsOrigins: [] };
    app = await createApp(config, { events: false });
    await app.listen(0);
    base = (await app.getUrl()).replace('[::1]', 'localhost');
    svc = createServiceDb({
      connectionString: config.databaseUrl,
      schema: 'ingestion',
    });
  });

  afterAll(async () => {
    await svc?.close();
    await app?.close();
  });

  async function post<T>(
    path: string,
    body: unknown,
  ): Promise<{ status: number; body: T }> {
    const response = await fetch(`${base}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    return { status: response.status, body: (await response.json()) as T };
  }

  async function upload(
    filename: string,
    mimeType: string,
    content: Buffer,
    extra: object = {},
  ) {
    const created = await post<CreateUploadResponse>('/uploads', {
      filename,
      mimeType,
      sizeBytes: content.length,
      ...extra,
    });
    expect(created.status).toBe(201);
    const put = await fetch(created.body.uploadUrl, {
      method: 'PUT',
      headers: created.body.uploadHeaders,
      body: content,
    });
    expect(put.status).toBe(200);
    return post<CompleteUploadResponse>(
      `/uploads/${created.body.uploadId}/complete`,
      {},
    );
  }

  it('stores a file, detects its format and emits upload.completed in the same transaction', async () => {
    const content = Buffer.from(`Esselunga\nTOTALE 3.69\n${randomUUID()}`);
    const done = await upload('scontrino.txt', 'text/plain', content, {
      description: 'Weekly shopping',
    });
    expect(done.status).toBe(200);
    expect(done.body.duplicate).toBe(false);
    expect(done.body.upload).toMatchObject({
      title: 'scontrino',
      description: 'Weekly shopping',
      fileFormat: 'TXT',
      mimeType: 'text/plain',
      status: 'TO_BE_PARSED',
      sizeBytes: content.length,
      categories: [],
      parsedAt: null,
    });

    const { rows } = await svc.pool.query(
      `select payload from ingestion.outbox where event_type = 'upload.completed@1' and payload->>'uploadId' = $1`,
      [done.body.upload.id],
    );
    expect(rows).toHaveLength(1);
  });

  it('serves the stored file inline for previews and as an attachment for downloads', async () => {
    const content = Buffer.from(`Bolletta luce\n${randomUUID()}`);
    const done = await upload('bolletta luce.txt', 'text/plain', content);
    const id = done.body.upload.id;

    for (const [path, disposition] of [
      ['preview', 'inline'],
      ['download', 'attachment'],
    ]) {
      const file = await fetch(`${base}/uploads/${id}/${path}`);
      expect(file.status).toBe(200);
      expect(Buffer.from(await file.arrayBuffer()).equals(content)).toBe(true);
      expect(file.headers.get('content-type')).toBe(
        'text/plain; charset=utf-8',
      );
      expect(file.headers.get('content-disposition')).toBe(
        `${disposition}; filename*=UTF-8''bolletta%20luce.txt`,
      );
    }

    const redirect = await fetch(`${base}/uploads/${id}/file`, {
      redirect: 'manual',
    });
    expect(redirect.status).toBe(302);
    const presigned = await fetch(redirect.headers.get('location') as string);
    expect(Buffer.from(await presigned.arrayBuffer()).equals(content)).toBe(
      true,
    );

    const listed = await fetch(`${base}/uploads?status=TO_BE_PARSED&limit=100`)
      .then((r) => r.json() as Promise<Page<UploadDto>>)
      .then((page) => page.items.find((item) => item.id === id));
    expect(listed).toMatchObject({ categories: [], parsedAt: null });

    const missing = await fetch(`${base}/uploads/${randomUUID()}/download`, {
      redirect: 'manual',
    });
    expect(missing.status).toBe(404);
  });

  it('returns the earlier upload when the same file is uploaded twice', async () => {
    const content = Buffer.from(`same file ${randomUUID()}`);
    const first = await upload('a.txt', 'text/plain', content);
    const second = await upload('b.txt', 'text/plain', content);
    expect(second.body.duplicate).toBe(true);
    expect(second.body.upload.id).toBe(first.body.upload.id);
  });

  it('marks a file whose bytes are not a supported format as FAILED', async () => {
    const done = await upload(
      'bill.pdf',
      'application/pdf',
      Buffer.from([0, 1, 2, 3, 0, 0, 7]),
    );
    expect(done.status).toBe(422);
    const list = await fetch(`${base}/uploads?status=FAILED&limit=100`).then(
      (r) => r.json() as Promise<Page<UploadDto>>,
    );
    expect(
      list.items.some((item) => item.title === 'bill' && item.lastError),
    ).toBe(true);
  });

  it('refuses unsupported types and invalid requests up front', async () => {
    expect(
      (
        await post('/uploads', {
          filename: 'a.exe',
          mimeType: 'application/x-msdownload',
          sizeBytes: 3,
        })
      ).status,
    ).toBe(415);
    const invalid = await post<{ issues: { path: string }[] }>('/uploads', {
      filename: 'a.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 3,
      description: 'x'.repeat(256),
    });
    expect(invalid.status).toBe(400);
    expect(invalid.body.issues[0].path).toBe('description');
  });

  it('refuses to complete an upload whose file never reached storage', async () => {
    const created = await post<CreateUploadResponse>('/uploads', {
      filename: 'ghost.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 10,
    });
    const done = await post(`/uploads/${created.body.uploadId}/complete`, {});
    expect(done.status).toBe(409);
  });
});
