import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import { createServiceDb, type ServiceDb } from '@life-island/be-common';
import {
  DIGEST_FREQUENCY_SETTING,
  DIGEST_RECIPIENT_SETTING,
  DIGEST_TIME_SETTING,
  isoAddDays,
  type AgendaBriefDto,
  type DigestDto,
  type DigestStatusDto,
  type AgendaOverviewDto,
  type AgendaUpcomingDto,
  type CalendarFeedDto,
  type CalendarFeedLinkDto,
  type LifeAttentionDto,
} from '@life-island/contracts';
import { createApp } from './bootstrap.js';
import { loadConfig } from './config.js';
import { today } from './agenda/agenda.service.js';
import { DigestService } from './digest/digest.service.js';
import type { Mail, Mailer } from './digest/mailer.js';

const MARIO = '6f1d2c3b-4a5e-4f60-8a7b-9c0d1e2f3a4b';
const ANNA = '7a2e3d4c-5b6f-4a71-9b8c-0d1e2f3a4b5c';

// Needs the compose stack: `npm run infra:up`, then `npm run test:integration`.
const configured = !!process.env['AGENDA_DATABASE_URL'];

describe.skipIf(!configured)(
  'Agenda (items, areas, handled dates, brief over HTTP)',
  () => {
    let app: INestApplication;
    let base: string;
    let svc: ServiceDb;
    let area: { close(): void } | null = null;
    let people: { close(): void } | null = null;
    const ids: string[] = [];
    // Email goes to a list here; `fail` makes the server refuse it.
    const sent: Mail[] = [];
    const mailer: Mailer & { fail: boolean } = {
      configured: true,
      fail: false,
      async send(mail) {
        if (this.fail) throw new Error('550 mailbox unavailable');
        sent.push(mail);
      },
    };

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
      // A fake "cars" area answering GET /deadlines and GET /attention; every other area is unreachable.
      const { createServer } = await import('node:http');
      const day = today();
      const server = createServer((req, res) => {
        res.setHeader('content-type', 'application/json');
        if (req.url?.startsWith('/attention')) {
          res.end(
            JSON.stringify({
              expired: 0,
              expiring: 1,
              toReview: 1,
              items: [
                {
                  id: 'document:upload-1',
                  kind: 'document',
                  title: 'Polizza RCA.pdf',
                  detail: null,
                  since: `${isoAddDays(day, -4)}T10:00:00.000Z`,
                  path: '/cars',
                  action: 'Review',
                },
                { id: 'broken', title: 'No path', path: 'https://evil' },
              ],
            }),
          );
          return;
        }
        res.end(
          JSON.stringify([
            {
              id: `insurance:car-1:${isoAddDays(day, 3)}`,
              module: 'cars',
              kind: 'insurance',
              title: 'Insurance of the Panda',
              detail: null,
              date: isoAddDays(day, 3),
              amount: 420,
              path: '/cars',
            },
          ]),
        );
      });
      await new Promise<void>((resolve) => server.listen(0, resolve));
      const port = (server.address() as { port: number }).port;
      area = { close: () => server.close() };
      // A fake People answering only GET /people: Mario has an email, Anna none.
      const peopleServer = createServer((req, res) => {
        res.setHeader('content-type', 'application/json');
        if (req.url !== '/people') {
          res.statusCode = 404;
          res.end('{}');
          return;
        }
        const person = (
          id: string,
          firstName: string,
          email: string | null,
        ) => ({
          id,
          firstName,
          lastName: 'ROSSI',
          taxCode: null,
          email,
          residencePropertyId: null,
          taxDependentOf: null,
          drivingLicence: null,
        });
        res.end(
          JSON.stringify([
            person(MARIO, 'MARIO', 'mario@example.com'),
            person(ANNA, 'ANNA', null),
          ]),
        );
      });
      await new Promise<void>((resolve) => peopleServer.listen(0, resolve));
      const peoplePort = (peopleServer.address() as { port: number }).port;
      people = { close: () => peopleServer.close() };
      const config = {
        ...loadConfig(),
        port: 0,
        anthropicApiKey: null,
        sources: {
          cars: `http://localhost:${port}`,
          people: `http://localhost:${peoplePort}`,
        },
        appUrl: 'https://island.example',
      };
      app = await createApp(config, {
        events: false,
        digestScheduler: false,
        mailer,
      });
      await app.listen(0);
      base = (await app.getUrl()).replace('[::1]', 'localhost');
      svc = createServiceDb({
        connectionString: config.databaseUrl,
        schema: 'agenda',
      });
    });

    afterAll(async () => {
      for (const id of ids)
        await svc?.pool.query('delete from agenda.agenda_items where id = $1', [
          id,
        ]);
      await svc?.pool.query(
        "delete from agenda.handled_entries where key like 'module:cars:insurance:car-1:%'",
      );
      await svc?.pool.query('delete from agenda.digest_sends');
      await svc?.pool.query('delete from agenda.calendar_feeds');
      await svc?.pool.query(
        "delete from agenda.settings_replica where key like 'agenda.digest-%'",
      );
      await svc?.close();
      await app?.close();
      area?.close();
      people?.close();
    });

    it('merges the areas, your items and the calendar, and marks a date as handled', async () => {
      const day = today();
      const added = await json<{ id: string }>('POST', '/items', {
        title: 'Call the plumber',
        date: isoAddDays(day, -2),
      });
      expect(added.status).toBe(201);
      ids.push(added.body.id);
      const monthly = await json<{ id: string }>('POST', '/items', {
        title: 'Pay the rent',
        date: isoAddDays(day, 1),
        repeat: 'monthly',
        category: 'money',
      });
      ids.push(monthly.body.id);

      const overview = await json<AgendaOverviewDto>('GET', '/overview');
      expect(overview.status).toBe(200);
      // The undated things the areas wait on you for, malformed ones left out.
      expect(overview.body.waiting).toEqual([
        expect.objectContaining({
          key: 'cars:document:upload-1',
          module: 'cars',
          since: isoAddDays(day, -4),
          action: 'Review',
        }),
      ]);
      const cars = overview.body.sources.find((s) => s.module === 'cars');
      expect(cars).toMatchObject({ ok: true, count: 1 });
      expect(overview.body.sources.find((s) => s.module === 'people')?.ok).toBe(
        false,
      );
      // The calendar files dates under Cars too (winter tyres from 15 November).
      const insurance = overview.body.entries.find(
        (e) => e.module === 'cars' && e.source === 'module',
      );
      expect(insurance).toMatchObject({
        daysLeft: 3,
        urgency: 'week',
        handled: false,
      });
      expect(
        overview.body.entries.filter((e) => e.itemId === monthly.body.id)
          .length,
      ).toBeGreaterThanOrEqual(12);
      expect(
        overview.body.entries.find((e) => e.itemId === added.body.id)?.urgency,
      ).toBe('overdue');
      expect(overview.body.entries.some((e) => e.source === 'calendar')).toBe(
        true,
      );

      const attention = await json<LifeAttentionDto>('GET', '/attention');
      expect(attention.body.expired).toBeGreaterThanOrEqual(1);
      expect(attention.body.expiring).toBeGreaterThanOrEqual(2);

      expect(
        (await json('PUT', '/handled', { key: insurance!.key, handled: true }))
          .status,
      ).toBe(204);
      expect(
        (
          await json('PUT', '/handled', {
            key: `item:${added.body.id}:x`,
            handled: true,
          })
        ).status,
      ).toBe(204);
      const upcoming = await json<AgendaUpcomingDto>('GET', '/upcoming?days=7');
      expect(upcoming.body.entries.some((e) => e.key === insurance!.key)).toBe(
        false,
      );
      expect(
        upcoming.body.entries.some((e) => e.itemId === added.body.id),
      ).toBe(false);
    });

    it('writes the week brief with its own rules when there is no key', async () => {
      const brief = await json<AgendaBriefDto>('POST', '/briefs', {});
      expect(brief.status).toBe(201);
      expect(brief.body.source).toBe('offline');
      expect(brief.body.output.summary).toBeTruthy();
      expect((await json('DELETE', `/briefs/${brief.body.id}`)).status).toBe(
        204,
      );
    });

    it('refuses an item without a title', async () => {
      const bad = await json<{ issues: unknown[] }>('POST', '/items', {
        date: today(),
      });
      expect(bad.status).toBe(400);
    });

    describe('the email digest', () => {
      const setting = (key: string, value: unknown) =>
        svc.pool.query(
          `insert into agenda.settings_replica (key, value, changed_at)
           values ($1, $2, '2020-01-01T00:00:00Z')
           on conflict (key) do update set value = excluded.value`,
          [key, JSON.stringify(value)],
        );

      beforeAll(async () => {
        await svc.pool.query('delete from agenda.digest_sends');
      });

      it('says it is off until you choose how often', async () => {
        const status = await json<DigestStatusDto>('GET', '/digest');
        expect(status.status).toBe(200);
        expect(status.body).toMatchObject({
          problem: 'off',
          recipient: null,
          next: null,
          mailConfigured: true,
        });
      });

      it('goes to the email of the person picked in People', async () => {
        await setting(DIGEST_FREQUENCY_SETTING, 'daily');
        await setting(DIGEST_TIME_SETTING, '07:30');
        await setting(DIGEST_RECIPIENT_SETTING, ANNA);
        const noEmail = await json<DigestStatusDto>('GET', '/digest');
        expect(noEmail.body.problem).toBe('no-email');
        expect(noEmail.body.recipient?.name).toBe('Anna Rossi');
        const refused = await json<{ message: string }>('POST', '/digest/test');
        expect(refused.status).toBe(422);
        expect(refused.body.message).toContain('Anna Rossi has no email');

        await setting(DIGEST_RECIPIENT_SETTING, MARIO);
        const status = await json<DigestStatusDto>('GET', '/digest');
        expect(status.body).toMatchObject({
          problem: null,
          schedule: 'Every day at 07:30',
          recipient: { id: MARIO, email: 'mario@example.com' },
        });
        expect(status.body.next).toMatch(/T07:30$/);
      });

      it('shows the digest before it is sent, and sends a test now', async () => {
        const preview = await json<DigestDto>('GET', '/digest/preview');
        expect(preview.status).toBe(200);
        // The insurance was marked handled above; tomorrow's rent remains.
        expect(preview.body.coming).toEqual([
          expect.objectContaining({
            title: 'Pay the rent',
            url: 'https://island.example/agenda',
          }),
        ]);
        expect(preview.body.text).toContain('Hi Mario,');

        const test = await json<{ to: string }>('POST', '/digest/test');
        expect(test.status).toBe(200);
        expect(test.body.to).toBe('mario@example.com');
        expect(sent.at(-1)).toMatchObject({
          to: 'mario@example.com',
          subject: preview.body.subject,
        });
      });

      it('sends each period once, and a refused one again only later', async () => {
        const digest = app.get(DigestService);
        const morning = new Date(`${today()}T07:00:00Z`); // 08:00 or 09:00 in Rome
        const before = sent.length;
        expect(await digest.tick(morning)).toMatchObject({
          period: `daily:${today()}`,
          status: 'sent',
          recipient: 'mario@example.com',
          attempts: 1,
        });
        expect(sent.length).toBe(before + 1);
        // Twice, or from a second instance: nothing more.
        expect(await digest.tick(morning)).toBeNull();
        expect(sent.length).toBe(before + 1);

        await svc.pool.query(
          'delete from agenda.digest_sends where period = $1',
          [`daily:${today()}`],
        );
        mailer.fail = true;
        expect(await digest.tick(morning)).toMatchObject({
          status: 'failed',
          error: '550 mailbox unavailable',
        });
        // Not again before its retry time…
        expect(await digest.tick(morning)).toBeNull();
        // …then again, once the time has come.
        await svc.pool.query(
          "update agenda.digest_sends set updated_at = now() - interval '1 hour' where period = $1",
          [`daily:${today()}`],
        );
        mailer.fail = false;
        expect(await digest.tick(morning)).toMatchObject({
          status: 'sent',
          attempts: 2,
        });

        const status = await json<DigestStatusDto>('GET', '/digest');
        expect(status.body.sends[0]).toMatchObject({
          period: `daily:${today()}`,
          status: 'sent',
        });
      });
    });

    describe('the private calendar link', () => {
      const feed = async (url: string) => {
        const response = await fetch(
          `${base}${new URL(url).pathname.replace('/api/agenda', '')}`,
        );
        return {
          status: response.status,
          type: response.headers.get('content-type'),
          body: await response.text(),
        };
      };

      it('is off until you make one', async () => {
        await svc.pool.query('delete from agenda.calendar_feeds');
        const status = await json<CalendarFeedDto>('GET', '/calendar');
        expect(status.body).toEqual({
          active: false,
          createdAt: null,
          lastReadAt: null,
        });
      });

      it('serves the dates to whoever has the link, and nothing to anyone else', async () => {
        const made = await json<CalendarFeedLinkDto>('POST', '/calendar');
        expect(made.status).toBe(201);
        expect(made.body.url).toMatch(
          /^https:\/\/island\.example\/api\/agenda\/calendar\/feed\/[A-Za-z0-9_-]{43}\.ics$/,
        );
        // Only the secret's hash is kept.
        const { rows } = await svc.pool.query<{ token_hash: string }>(
          'select token_hash from agenda.calendar_feeds',
        );
        expect(rows).toHaveLength(1);
        expect(made.body.url).not.toContain(rows[0].token_hash);

        const read = await feed(made.body.url);
        expect(read.status).toBe(200);
        expect(read.type).toContain('text/calendar');
        expect(read.body).toContain('BEGIN:VCALENDAR');
        expect(read.body).toContain('Pay the rent');
        expect(
          (await json<CalendarFeedDto>('GET', '/calendar')).body.lastReadAt,
        ).not.toBeNull();

        const wrong = made.body.url.replace(/feed\/./, (m) =>
          m.endsWith('A') ? `${m.slice(0, -1)}B` : `${m.slice(0, -1)}A`,
        );
        expect((await feed(wrong)).status).toBe(404);
        expect((await json('GET', '/calendar/feed/short.ics')).status).toBe(
          404,
        );

        // A new link stops the old one; turning it off stops them all.
        const renewed = await json<CalendarFeedLinkDto>('POST', '/calendar');
        expect((await feed(made.body.url)).status).toBe(404);
        expect((await feed(renewed.body.url)).status).toBe(200);
        expect((await json('DELETE', '/calendar')).status).toBe(204);
        expect((await feed(renewed.body.url)).status).toBe(404);
        expect(
          (await json<CalendarFeedDto>('GET', '/calendar')).body.active,
        ).toBe(false);
      });
    });
  },
);
