import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import { createServiceDb, type ServiceDb } from '@life-island/be-common';
import {
  isoAddDays,
  type MatchesDto,
  type MoneyOverviewDto,
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

/*
 * Receipts and orders reach Money only through the documents app: Groceries
 * loads the ones you confirm there and lists them on GET /payables, with
 * their lines. A card receipt pairs with its bank movement and fills its
 * note and parts; a cash one becomes a movement of your cash, linked.
 */
describe.skipIf(!configured)(
  'Money receipts (from the documents app, through Groceries)',
  () => {
    let app: INestApplication;
    let base: string;
    let svc: ServiceDb;
    let groceries: Server;
    const accounts: string[] = [];
    let listed: PayableDto[] = [];
    // Letters only: a word with a digit is a code to the matcher, never a name.
    const run = Math.random()
      .toString(36)
      .replace(/[^a-z]/g, '')
      .slice(0, 6);
    const day = isoAddDays(today(), -3);

    const receipt = (over: Partial<PayableDto> = {}): PayableDto => ({
      key: `groceries:receipt:card-${run}`,
      module: 'groceries',
      kind: 'receipt',
      title: `Amazon ${run}, receipt of ${day}`,
      payees: [`Amazon ${run}`],
      amount: 70.42,
      direction: 'out',
      date: day,
      window: { from: isoAddDays(day, -1), to: isoAddDays(day, 5) },
      path: '/groceries',
      lines: [
        { name: 'Detergent x2', amount: 36.64, category: 'groceries' },
        { name: 'Bamboo placemats', amount: 27.99, category: 'shopping' },
        { name: 'Ibuprofen', amount: 4.5, category: 'health' },
        { name: 'Whole milk 1 L', amount: 1.29, category: 'groceries' },
      ],
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

    const account = async (name: string, kind: string) => {
      const created = await json<{ id: string }>('POST', '/accounts', {
        name: `${name} ${run}`,
        kind,
        openingDate: isoAddDays(day, -30),
      });
      expect(created.status).toBe(201);
      accounts.push(created.body.id);
      return created.body.id;
    };

    const movementOf = async (id: string) =>
      (await json<MoneyOverviewDto>('GET', '/overview')).body.transactions.find(
        (t) => t.id === id,
      );

    beforeAll(async () => {
      groceries = createServer((request, response) => {
        if (!request.url?.startsWith('/payables')) {
          response.writeHead(404).end();
          return;
        }
        response
          .writeHead(200, { 'content-type': 'application/json' })
          .end(JSON.stringify(listed));
      });
      await new Promise<void>((resolve) => groceries.listen(0, resolve));
      const config = {
        ...loadConfig(),
        port: 0,
        anthropicApiKey: null,
        payableSources: {
          groceries: `http://localhost:${(groceries.address() as AddressInfo).port}`,
        },
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
      for (const id of accounts) await json('DELETE', `/accounts/${id}`);
      await svc?.close();
      await app?.close();
      await new Promise((resolve) => groceries?.close(resolve));
    });

    it('fills the category, the note and the parts of a card movement from its receipt', async () => {
      const card = await account('Receipts card', 'card');
      listed = [receipt()];
      const created = await json<{ id: string }>('POST', '/transactions', {
        accountId: card,
        date: isoAddDays(day, 1),
        amount: -70.42,
        description: `PAGAMENTO POS AMZN Mktp IT*2K4LS0X15 ${run}`,
        category: 'shopping',
      });
      const movementId = created.body.id;

      const matches = (await json<MatchesDto>('GET', '/matches')).body;
      const suggestion = matches.suggestions.find(
        (s) => s.movementId === movementId,
      );
      expect(suggestion?.payableKeys).toEqual([receipt().key]);
      const linked = await json<MovementLinkDto[]>('POST', '/matches/links', {
        movementId,
        items: [{ payableKey: receipt().key, amount: 70.42 }],
      });
      expect(linked.status).toBe(201);

      expect(await movementOf(movementId)).toMatchObject({
        category: 'groceries',
        notes:
          'Detergent x2 €36.64, Bamboo placemats €27.99, Ibuprofen €4.50, Whole milk 1 L €1.29',
        splits: [
          { category: 'shopping', amount: 27.99 },
          { category: 'health', amount: 4.5 },
        ],
      });
    });

    it('never overwrites a note you wrote', async () => {
      const card = accounts[0];
      const key = `groceries:receipt:mine-${run}`;
      listed = [receipt({ key, amount: 12.5 })];
      const created = await json<{ id: string }>('POST', '/transactions', {
        accountId: card,
        date: day,
        amount: -12.5,
        description: `AMZN Mktp ${run}`,
        notes: 'Birthday present',
      });
      await json('POST', '/matches/links', {
        movementId: created.body.id,
        items: [{ payableKey: key, amount: 12.5 }],
      });
      expect(await movementOf(created.body.id)).toMatchObject({
        notes: 'Birthday present',
        splits: [],
      });
    });

    it('adds a receipt paid in cash to your cash, once, with its lines', async () => {
      const wallet = await account('Wallet', 'cash');
      const key = `groceries:receipt:cash-${run}`;
      const cash = receipt({
        key,
        title: `Bakery ${run}, receipt of ${day}`,
        payees: [`Bakery ${run}`],
        amount: 9.3,
        window: { from: day, to: day },
        paidInCash: true,
        lines: [
          { name: 'Bread', amount: 3.3, category: 'groceries' },
          { name: 'Cake', amount: 6, category: 'groceries' },
        ],
      });
      listed = [cash];

      const matches = (await json<MatchesDto>('GET', '/matches')).body;
      expect(matches.suggestions.some((s) => s.payableKeys.includes(key))).toBe(
        false,
      );
      const attention = await json<{ items: { id: string }[] }>(
        'GET',
        '/attention',
      );
      expect(attention.body.items.map((i) => i.id)).toContain('match:cash');

      const added = await json<MovementLinkDto[]>('POST', '/matches/cash', {
        payableKey: key,
        date: day,
        accountId: wallet,
      });
      expect(added.status).toBe(201);
      const movement = await movementOf(added.body[0].movementId);
      expect(movement).toMatchObject({
        accountId: wallet,
        date: day,
        amount: -9.3,
        description: `Bakery ${run}`,
        category: 'groceries',
        channel: 'store',
        notes: 'Cake €6.00, Bread €3.30',
        splits: [],
      });

      const again = await json<{ message: string }>('POST', '/matches/cash', {
        payableKey: key,
        date: day,
        accountId: wallet,
      });
      expect(again.status).toBe(409);
      const { rows } = await svc.pool.query(
        'select 1 from money.transactions where account_id = $1',
        [wallet],
      );
      expect(rows).toHaveLength(1);
    });

    it('adds by hand only what was paid in cash', async () => {
      listed = [receipt({ key: `groceries:receipt:card2-${run}` })];
      const refused = await json('POST', '/matches/cash', {
        payableKey: `groceries:receipt:card2-${run}`,
        date: day,
        accountId: accounts[0],
      });
      expect(refused.status).toBe(400);
    });
  },
);
