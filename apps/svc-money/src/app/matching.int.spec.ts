import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import { createServiceDb, type ServiceDb } from '@life-island/be-common';
import {
  isoAddDays,
  type LifeAttentionDto,
  type MatchesDto,
  type MovementLinkDto,
  type PayableDto,
} from '@life-island/contracts';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createApp } from './bootstrap.js';
import { loadConfig } from './config.js';
import { today } from './money/money.service.js';

// Needs the compose stack: `npm run infra:up`, then `npm run test:integration`.
const configured = !!process.env['MONEY_DATABASE_URL'];

describe.skipIf(!configured)(
  'Money matching (movements paired with the bills of Houses)',
  () => {
    let app: INestApplication;
    let base: string;
    let svc: ServiceDb;
    let houses: Server;
    let accountId = '';
    /** What the fake Houses answers on GET /payables; null: it is down. */
    let listed: PayableDto[] | null = [];
    const run = Math.random().toString(36).slice(2, 8);
    const day = today();
    const due = isoAddDays(day, -10);

    const payable = (over: Partial<PayableDto> = {}): PayableDto => ({
      key: `home:bill:enel-${run}`,
      module: 'home',
      kind: 'bill',
      title: `Enel ${run}, electricity bill`,
      payees: ['Enel Energia S.p.A.'],
      amount: 84.37,
      direction: 'out',
      date: due,
      window: { from: isoAddDays(due, -20), to: isoAddDays(due, 45) },
      autoPay: false,
      path: '/home/bills',
      ...over,
    });

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

    /** This run's links: the database may hold others. */
    const ours = (matches: MatchesDto) =>
      matches.links.filter((l) => l.payableKey.includes(run));

    const events = async (type: string) =>
      (
        await svc.pool.query<{ payload: Record<string, unknown> }>(
          `select payload from money.outbox where event_type = $1 and payload->>'payableKey' like $2 order by created_at`,
          [type, `%${run}%`],
        )
      ).rows.map((r) => r.payload);

    const movement = async (
      amount: number,
      description: string,
      date = due,
    ) => {
      const created = await json<{ id: string }>('POST', '/transactions', {
        accountId,
        date,
        amount,
        description,
      });
      expect(created.status).toBe(201);
      return created.body.id;
    };

    beforeAll(async () => {
      houses = createServer((request, response) => {
        if (!request.url?.startsWith('/payables') || listed === null) {
          response.writeHead(503).end();
          return;
        }
        response.writeHead(200, { 'content-type': 'application/json' }).end(
          JSON.stringify([
            ...listed,
            // Another area's item, sent by Houses: never trusted.
            { ...payable(), key: `taxes:expense:x-${run}`, module: 'taxes' },
          ]),
        );
      });
      await new Promise<void>((resolve) => houses.listen(0, resolve));
      const config = {
        ...loadConfig(),
        port: 0,
        anthropicApiKey: null,
        payableSources: {
          home: `http://localhost:${(houses.address() as AddressInfo).port}`,
        },
      };
      app = await createApp(config, { events: false });
      await app.listen(0);
      base = (await app.getUrl()).replace('[::1]', 'localhost');
      svc = createServiceDb({
        connectionString: config.databaseUrl,
        schema: 'money',
      });
      const account = await json<{ id: string }>('POST', '/accounts', {
        name: `Matching ${run}`,
        openingBalance: 1000,
        openingDate: isoAddDays(day, -200),
      });
      accountId = account.body.id;
    });

    afterAll(async () => {
      if (accountId) {
        await svc?.pool.query(
          `delete from money.movement_links where transaction_id in
             (select id from money.transactions where account_id = $1)`,
          [accountId],
        );
        await svc?.pool.query('delete from money.accounts where id = $1', [
          accountId,
        ]);
      }
      await svc?.pool.query(
        `delete from money.outbox where payload->>'payableKey' like $1`,
        [`%${run}%`],
      );
      await svc?.close();
      await app?.close();
      await new Promise((resolve) => houses?.close(resolve));
    });

    it('proposes, links once, refuses what would pay twice, and tells Houses', async () => {
      listed = [payable()];
      const enel = await movement(
        -84.37,
        'ADDEBITO SDD CORE ENEL ENERGIA SPA CID IT45ZZZ0000001',
      );
      const other = await movement(-84.37, 'ADDEBITO SDD A2A ENERGIA');

      const matches = await json<MatchesDto>('GET', '/matches');
      expect(matches.status).toBe(200);
      expect(matches.body.sources).toEqual([
        expect.objectContaining({ module: 'home', ok: true, count: 1 }),
        // Not given to this test: said so, and the rest still matched.
        expect.objectContaining({ module: 'cars', ok: false }),
        expect.objectContaining({ module: 'subscriptions', ok: false }),
        expect.objectContaining({ module: 'work', ok: false }),
        expect.objectContaining({ module: 'groceries', ok: false }),
        expect.objectContaining({ module: 'taxes', ok: false }),
      ]);
      expect(matches.body.payables.map((p) => p.key)).toEqual([payable().key]);
      const suggestion = matches.body.suggestions.find(
        (s) => s.movementId === enel,
      );
      expect(suggestion).toMatchObject({
        payableKeys: [payable().key],
        amounts: [84.37],
        confidence: 'sure',
      });
      // The bank names someone else: never proposed.
      expect(matches.body.suggestions.some((s) => s.movementId === other)).toBe(
        false,
      );

      const attention = await json<LifeAttentionDto>('GET', '/attention');
      expect(attention.body.items).toContainEqual(
        expect.objectContaining({ kind: 'match', path: '/money?tab=match' }),
      );

      // Two confirmations of the same bill at the same time, from two
      // movements: exactly one wins.
      const [a, b] = await Promise.all([
        json<MovementLinkDto[]>('POST', '/matches/links', {
          movementId: enel,
          items: [{ payableKey: payable().key, amount: 84.37 }],
        }),
        json<MovementLinkDto[]>('POST', '/matches/links', {
          movementId: other,
          items: [{ payableKey: payable().key, amount: 84.37 }],
        }),
      ]);
      expect([a.status, b.status].sort()).toEqual([201, 409]);
      const winner = a.status === 201 ? a : b;
      const winnerMovement = a.status === 201 ? enel : other;
      expect(winner.body[0]).toMatchObject({
        movementId: winnerMovement,
        payableKey: payable().key,
        amount: 84.37,
        status: 'ok',
      });

      // The same pair again, and an item of an area Money does not read.
      expect(
        (
          await json('POST', '/matches/links', {
            movementId: winnerMovement,
            items: [{ payableKey: payable().key, amount: 1 }],
          })
        ).status,
      ).toBe(409);
      expect(
        (
          await json('POST', '/matches/links', {
            movementId: winnerMovement,
            items: [{ payableKey: `dreams:goal:x-${run}`, amount: 1 }],
          })
        ).status,
      ).toBe(400);
      // An area Money reads but cannot reach now: nothing is linked.
      expect(
        (
          await json('POST', '/matches/links', {
            movementId: winnerMovement,
            items: [{ payableKey: `taxes:expense:x-${run}`, amount: 1 }],
          })
        ).status,
      ).toBe(503);

      const [event] = await events('money.payment_linked@1');
      expect(event).toMatchObject({
        linkId: winner.body[0].id,
        payableKey: payable().key,
        module: 'home',
        movementId: winnerMovement,
        date: due,
        amount: 84.37,
        accountName: `Matching ${run}`,
      });

      const after = await json<MatchesDto>('GET', '/matches');
      expect(after.body.payables[0]).toMatchObject({ linked: 84.37 });
      expect(ours(after.body).map((l) => l.status)).toEqual(['ok']);
      expect(
        after.body.suggestions.some((s) =>
          s.payableKeys.includes(payable().key),
        ),
      ).toBe(false);

      // The bill now costs less than what is linked: the link is flagged.
      listed = [payable({ amount: 80 })];
      expect(
        ours((await json<MatchesDto>('GET', '/matches')).body)[0].status,
      ).toBe('changed');
      listed = [];
      expect(
        ours((await json<MatchesDto>('GET', '/matches')).body)[0].status,
      ).toBe('gone');
      listed = null;
      const down = await json<MatchesDto>('GET', '/matches');
      expect(down.status).toBe(200);
      expect(ours(down.body)[0].status).toBe('unknown');
      expect(down.body.sources[0]).toMatchObject({ ok: false });
      listed = [payable()];
    });

    it('pays a bill in two parts, never more than it costs or the movement moved', async () => {
      const bill = payable({ key: `home:bill:split-${run}`, amount: 100 });
      listed = [bill];
      const first = await movement(-60, 'BONIFICO ENEL ENERGIA');
      const second = await movement(-60, 'BONIFICO ENEL ENERGIA');
      expect(
        (
          await json('POST', '/matches/links', {
            movementId: first,
            items: [{ payableKey: bill.key, amount: 70 }],
          })
        ).status,
      ).toBe(409); // more than the movement
      expect(
        (
          await json('POST', '/matches/links', {
            movementId: first,
            items: [{ payableKey: bill.key, amount: 60 }],
          })
        ).status,
      ).toBe(201);
      expect(
        (
          await json('POST', '/matches/links', {
            movementId: second,
            items: [{ payableKey: bill.key, amount: 60 }],
          })
        ).status,
      ).toBe(409); // more than the bill
      expect(
        (
          await json('POST', '/matches/links', {
            movementId: second,
            items: [{ payableKey: bill.key, amount: 40 }],
          })
        ).status,
      ).toBe(201);

      // A movement in, against a bill out.
      const refund = await movement(40, 'RIMBORSO ENEL ENERGIA');
      expect(
        (
          await json('POST', '/matches/links', {
            movementId: refund,
            items: [{ payableKey: bill.key, amount: 1 }],
          })
        ).status,
      ).toBe(400);

      // Houses down: nothing can be checked, so nothing is linked.
      listed = null;
      expect(
        (
          await json('POST', '/matches/links', {
            movementId: refund,
            items: [{ payableKey: bill.key, amount: 1 }],
          })
        ).status,
      ).toBe(503);
      listed = [bill];
    });

    it('keeps a linked movement honest: no shrinking, no flipping, and undoes links when it goes', async () => {
      const bill = payable({ key: `home:bill:edit-${run}`, amount: 50 });
      listed = [bill];
      const paid = await movement(-50, 'ADDEBITO SDD ENEL ENERGIA');
      const [link] = (
        await json<MovementLinkDto[]>('POST', '/matches/links', {
          movementId: paid,
          items: [{ payableKey: bill.key, amount: 50 }],
        })
      ).body;

      expect(
        (await json('PUT', `/transactions/${paid}`, { amount: -40 })).status,
      ).toBe(409);
      expect(
        (await json('PUT', `/transactions/${paid}`, { amount: 50 })).status,
      ).toBe(409);
      expect(
        (
          await json('PUT', `/transactions/${paid}`, {
            amount: -55,
            notes: 'with a fee',
          })
        ).status,
      ).toBe(204);

      // Undo, by you.
      expect((await json('DELETE', `/matches/links/${link.id}`)).status).toBe(
        204,
      );
      expect((await json('DELETE', `/matches/links/${link.id}`)).status).toBe(
        404,
      );
      const undone = await events('money.payment_unlinked@1');
      expect(undone.at(-1)).toMatchObject({
        linkId: link.id,
        payableKey: bill.key,
        reason: 'undone',
      });

      // Removing a linked movement undoes its link first.
      const [again] = (
        await json<MovementLinkDto[]>('POST', '/matches/links', {
          movementId: paid,
          items: [{ payableKey: bill.key, amount: 50 }],
        })
      ).body;
      expect((await json('DELETE', `/transactions/${paid}`)).status).toBe(204);
      expect((await events('money.payment_unlinked@1')).at(-1)).toMatchObject({
        linkId: again.id,
        reason: 'movement-removed',
      });
      expect((await json('DELETE', `/transactions/${paid}`)).status).toBe(404);
    });

    it('remembers "not this one"', async () => {
      const bill = payable({ key: `home:bill:no-${run}`, amount: 33.33 });
      listed = [bill];
      const charge = await movement(-33.33, 'ADDEBITO SDD ENEL ENERGIA');
      const proposed = (await json<MatchesDto>('GET', '/matches')).body;
      expect(proposed.suggestions.some((s) => s.movementId === charge)).toBe(
        true,
      );
      expect(
        (
          await json('POST', '/matches/rejections', {
            movementId: charge,
            payableKeys: [bill.key],
          })
        ).status,
      ).toBe(204);
      const after = (await json<MatchesDto>('GET', '/matches')).body;
      expect(after.suggestions.some((s) => s.movementId === charge)).toBe(
        false,
      );
    });

    it('removes an account with linked movements, undoing the links', async () => {
      const bill = payable({ key: `home:bill:acct-${run}`, amount: 12 });
      listed = [bill];
      const other = await json<{ id: string }>('POST', '/accounts', {
        name: `Closing ${run}`,
        openingBalance: 0,
      });
      const charge = await json<{ id: string }>('POST', '/transactions', {
        accountId: other.body.id,
        date: due,
        amount: -12,
        description: 'ENEL ENERGIA',
      });
      const [link] = (
        await json<MovementLinkDto[]>('POST', '/matches/links', {
          movementId: charge.body.id,
          items: [{ payableKey: bill.key, amount: 12 }],
        })
      ).body;
      expect((await json('DELETE', `/accounts/${other.body.id}`)).status).toBe(
        204,
      );
      expect((await events('money.payment_unlinked@1')).at(-1)).toMatchObject({
        linkId: link.id,
        reason: 'movement-removed',
      });
    });

    it('links a sure direct debit on its own, and never again once you undo it', async () => {
      const bill = payable({
        key: `home:bill:sdd-${run}`,
        amount: 71.15,
        autoPay: true,
      });
      // Paid automatically, but the bank names no one: still asked.
      const unnamed = payable({
        key: `home:bill:codes-${run}`,
        amount: 19.9,
        autoPay: true,
      });
      listed = [bill, unnamed];
      const debit = await movement(-71.15, 'ADDEBITO SDD ENEL ENERGIA SPA');
      const codes = await movement(-19.9, 'ADDEBITO DIRETTO SDD CID IT45ZZZ01');

      const matches = (await json<MatchesDto>('GET', '/matches')).body;
      expect(
        ours(matches).find((l) => l.payableKey === bill.key),
      ).toMatchObject({
        movementId: debit,
        amount: 71.15,
        auto: true,
        status: 'ok',
      });
      expect(matches.suggestions.some((s) => s.movementId === debit)).toBe(
        false,
      );
      expect(
        matches.suggestions.find((s) => s.movementId === codes),
      ).toMatchObject({ confidence: 'likely', payableKeys: [unnamed.key] });
      expect(
        (await events('money.payment_linked@1')).filter(
          (e) => e['payableKey'] === bill.key,
        ),
      ).toHaveLength(1);

      // Asking again links nothing twice.
      await json('GET', '/matches');
      const [link] = ours(
        (await json<MatchesDto>('GET', '/matches')).body,
      ).filter((l) => l.payableKey === bill.key);
      expect((await json('DELETE', `/matches/links/${link.id}`)).status).toBe(
        204,
      );
      const after = (await json<MatchesDto>('GET', '/matches')).body;
      expect(ours(after).some((l) => l.payableKey === bill.key)).toBe(false);
      expect(after.suggestions.some((s) => s.movementId === debit)).toBe(false);
    });
  },
);
