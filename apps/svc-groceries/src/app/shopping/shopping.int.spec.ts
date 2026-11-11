import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import { createServiceDb, type ServiceDb } from '@life-island/be-common';
import {
  isoAddDays,
  type GroceriesOverviewDto,
  type ShoppingSuggestionDto,
} from '@life-island/contracts';
import { randomUUID } from 'node:crypto';
import { createApp } from '../bootstrap.js';
import { loadConfig } from '../config.js';
import { today } from './shopping.service.js';

// Needs the compose stack: `npm run infra:up`, then `npm run test:integration`.
const configured = !!process.env['GROCERY_DATABASE_URL'];

describe.skipIf(!configured)(
  'groceries (stats, shopping list, suggestions over HTTP)',
  () => {
    let app: INestApplication;
    let base: string;
    let svc: ServiceDb;
    const item = `latte test ${randomUUID().slice(0, 6)}`;
    let merchantId = '';

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
      const config = { ...loadConfig(), port: 0, anthropicApiKey: null };
      app = await createApp(config, { events: false });
      await app.listen(0);
      base = (await app.getUrl()).replace('[::1]', 'localhost');
      svc = createServiceDb({
        connectionString: config.databaseUrl,
        schema: 'grocery',
      });
      // Three receipts a week apart, the last one 8 days ago: the milk is due.
      const { rows } = await svc.pool.query<{ id: string }>(
        `insert into grocery.merchants (merchant_key, name) values ($1, $2) returning id`,
        [`name:${item}`, `Shop ${item}`],
      );
      merchantId = rows[0].id;
      for (const [n, price] of [
        [22, 1.2],
        [15, 1.3],
        [8, 1.45],
      ] as const) {
        const r = await svc.pool.query<{ id: string }>(
          `insert into grocery.receipts (source_staging_id, upload_id, merchant_id, purchased_at, currency, total, approved_at)
         values ($1, $2, $3, $4::date + time '12:00', 'EUR', $5, now()) returning id`,
          [
            randomUUID(),
            randomUUID(),
            merchantId,
            isoAddDays(today(), -n),
            price,
          ],
        );
        await svc.pool.query(
          `insert into grocery.receipt_items (receipt_id, position, raw_name, normalized_name, category, quantity, unit_price, line_total)
         values ($1, 1, $2, $2, 'dairy', 1, $3, $3)`,
          [r.rows[0].id, item, price],
        );
      }
    });

    afterAll(async () => {
      await svc?.pool.query(
        'delete from grocery.receipts where merchant_id = $1',
        [merchantId],
      );
      await svc?.pool.query('delete from grocery.merchants where id = $1', [
        merchantId,
      ]);
      await svc?.pool.query(
        'delete from grocery.shopping_items where name = $1',
        [item],
      );
      await svc?.close();
      await app?.close();
    });

    it('works out how often an item is bought and how its price moved', async () => {
      const overview = await json<GroceriesOverviewDto>('GET', '/overview');
      expect(overview.status).toBe(200);
      expect(overview.body.items.find((i) => i.name === item)).toMatchObject({
        purchases: 3,
        everyDays: 7,
        lastPrice: 1.45,
        priceChange: 0.21,
      });
    });

    it('suggests the due items with its own rules, puts them on the list and clears them when bought', async () => {
      const suggestion = await json<ShoppingSuggestionDto>(
        'POST',
        '/suggestions',
        {},
      );
      expect(suggestion.body.source).toBe('offline');
      expect(suggestion.body.output.items.some((i) => i.name === item)).toBe(
        true,
      );
      expect(suggestion.body.output.tips.some((t) => t.includes(item))).toBe(
        true,
      );

      expect(
        (
          await json<{ added: number }>(
            'POST',
            `/suggestions/${suggestion.body.id}/apply`,
            { names: [item] },
          )
        ).body.added,
      ).toBe(1);
      expect(
        (
          await json<{ added: number }>(
            'POST',
            `/suggestions/${suggestion.body.id}/apply`,
            { names: [item] },
          )
        ).body.added,
      ).toBe(0);

      let overview = await json<GroceriesOverviewDto>('GET', '/overview');
      const onList = overview.body.list.find((i) => i.name === item)!;
      expect(onList.category).toBe('dairy');
      expect(
        (await json('PUT', `/list/${onList.id}`, { done: true })).status,
      ).toBe(204);
      expect((await json('DELETE', '/list/done')).status).toBe(204);
      overview = await json<GroceriesOverviewDto>('GET', '/overview');
      expect(overview.body.list.some((i) => i.name === item)).toBe(false);
      expect(
        (await json('DELETE', `/suggestions/${suggestion.body.id}`)).status,
      ).toBe(204);
    });
  },
);
