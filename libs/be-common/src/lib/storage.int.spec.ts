import { randomUUID } from 'node:crypto';
import { ObjectStorage, storageOptionsFromEnv } from './storage.js';

// Needs the compose stack (SeaweedFS): `npm run infra:up`, then `npm run test:integration`.
const configured =
  !!process.env['S3_ENDPOINT'] && !!process.env['S3_ACCESS_KEY'];

describe.skipIf(!configured)('ObjectStorage', () => {
  const storage = configured
    ? new ObjectStorage({ ...storageOptionsFromEnv(), bucket: 'int-test' })
    : (undefined as unknown as ObjectStorage);
  const origin = 'http://localhost:4201';

  beforeAll(() => storage.ensureBucket([origin]));

  it('lets a browser PUT through a presigned URL, then reads the object back', async () => {
    // The last key segment is the default download name (SeaweedFS ignores the override; R2 honours it).
    const key = `test/${randomUUID()}/hello.txt`;
    const url = await storage.presignPut(key, 'text/plain');
    const preflight = await fetch(url, {
      method: 'OPTIONS',
      headers: {
        origin,
        'access-control-request-method': 'PUT',
        'access-control-request-headers': 'content-type',
      },
    });
    expect(preflight.headers.get('access-control-allow-origin')).toBe(origin);

    const put = await fetch(url, {
      method: 'PUT',
      headers: { 'content-type': 'text/plain' },
      body: 'hello',
    });
    expect(put.status).toBe(200);
    expect(await storage.head(key)).toEqual({
      sizeBytes: 5,
      contentType: 'text/plain',
    });
    expect((await storage.getBytes(key)).toString()).toBe('hello');

    const download = await fetch(
      await storage.presignGet(key, { filename: 'hello.txt' }),
    );
    expect(await download.text()).toBe('hello');
    expect(download.headers.get('content-disposition')).toContain('hello.txt');

    await storage.delete(key);
    expect(await storage.head(key)).toBeUndefined();
  });

  it('rejects a presigned PUT with a different content type', async () => {
    const url = await storage.presignPut(
      `test/${randomUUID()}.txt`,
      'text/plain',
    );
    const put = await fetch(url, {
      method: 'PUT',
      headers: { 'content-type': 'image/png' },
      body: 'x',
    });
    expect(put.status).toBe(403);
  });
});
