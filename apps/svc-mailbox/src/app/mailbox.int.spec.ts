import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import { createServiceDb, type ServiceDb } from '@life-island/be-common';
import {
  isoAddDays,
  type DeadlineDto,
  type LetterDto,
  type MailboxOverviewDto,
} from '@life-island/contracts';
import { createApp } from './bootstrap.js';
import { loadConfig } from './config.js';
import { today } from './mailbox/mailbox.service.js';

// Needs the compose stack: `npm run infra:up`, then `npm run test:integration`.
const configured = !!process.env['MAILBOX_DATABASE_URL'];

describe.skipIf(!configured)('Mailbox (letters, reading, deadlines over HTTP)', () => {
  let app: INestApplication;
  let base: string;
  let svc: ServiceDb;
  const ids: string[] = [];

  const json = async <T>(method: string, path: string, body?: unknown) => {
    const response = await fetch(`${base}${path}`, {
      method,
      headers: body ? { 'content-type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await response.text();
    return { status: response.status, body: (text ? JSON.parse(text) : undefined) as T };
  };

  beforeAll(async () => {
    const config = { ...loadConfig(), port: 0, anthropicApiKey: null };
    app = await createApp(config, { events: false });
    await app.listen(0);
    base = (await app.getUrl()).replace('[::1]', 'localhost');
    svc = createServiceDb({ connectionString: config.databaseUrl, schema: 'mailbox' });
  });

  afterAll(async () => {
    for (const id of ids) await svc?.pool.query('delete from mailbox.letters where id = $1', [id]);
    await svc?.close();
    await app?.close();
  });

  it('guesses the kind, reads amount and date from the text, and sends the date to the agenda', async () => {
    const due = isoAddDays(today(), 20);
    const [y, m, d] = due.split('-');
    const letter = await json<{ id: string }>('POST', '/letters', {
      receivedOn: today(),
      sender: 'Polizia Locale di Milano',
      subject: 'Verbale di contravvenzione n. 1234',
      text: `Il verbale per violazione del codice della strada. Importo da pagare: € 1.042,50 entro il ${d}/${m}/${y}.`,
    });
    expect(letter.status).toBe(201);
    ids.push(letter.body.id);

    const explained = await json<LetterDto>('POST', `/letters/${letter.body.id}/explain`);
    expect(explained.status).toBe(201);
    expect(explained.body.kind).toBe('fine');
    expect(explained.body.explanation).toMatchObject({ source: 'offline', output: { amount: 1042.5, dueOn: due } });

    expect((await json('POST', `/letters/${letter.body.id}/apply-explanation`)).status).toBe(204);
    const overview = await json<MailboxOverviewDto>('GET', '/overview');
    expect(overview.body.letters.find((l) => l.id === letter.body.id)).toMatchObject({ amount: 1042.5, dueOn: due, daysLeft: 20 });
    expect(overview.body.totals.toPay).toBeGreaterThanOrEqual(1042.5);

    const deadlines = await json<DeadlineDto[]>('GET', '/deadlines');
    expect(deadlines.body.find((x) => x.id.startsWith(`letter:${letter.body.id}`))).toMatchObject({ date: due, amount: 1042.5 });

    expect((await json('PUT', `/letters/${letter.body.id}`, { status: 'done' })).status).toBe(204);
    const after = await json<DeadlineDto[]>('GET', '/deadlines');
    expect(after.body.some((x) => x.id.startsWith(`letter:${letter.body.id}`))).toBe(false);
  });
});
