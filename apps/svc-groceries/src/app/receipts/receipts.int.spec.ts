import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import {
  createServiceDb,
  paymentEventHandler,
  processOnce,
  recordApprovedHandler,
  type ServiceDb,
} from '@life-island/be-common';
import type {
  EventEnvelope,
  Page,
  PayableDto,
  ReceiptDetailDto,
  ReceiptDto,
  RecordApprovedV1,
} from '@life-island/contracts';
import { randomUUID } from 'node:crypto';
import { createApp } from '../bootstrap.js';
import { loadConfig } from '../config.js';
import { receiptLoader } from './receipt-loader.js';

// Needs the compose stack: `npm run infra:up`, then `npm run test:integration`.
const configured = !!process.env['GROCERY_DATABASE_URL'];

describe.skipIf(!configured)(
  'groceries (record.approved → receipts → HTTP)',
  () => {
    let app: INestApplication;
    let base: string;
    let svc: ServiceDb;
    const merchantName = `Esselunga ${randomUUID().slice(0, 8)}`;
    const handle = recordApprovedHandler('grocery', receiptLoader);

    beforeAll(async () => {
      const config = { ...loadConfig(), port: 0 };
      app = await createApp(config, { events: false });
      await app.listen(0);
      base = (await app.getUrl()).replace('[::1]', 'localhost');
      svc = createServiceDb({
        connectionString: config.databaseUrl,
        schema: 'grocery',
      });
    });

    afterAll(async () => {
      await svc?.pool.query(
        `delete from grocery.payments where payable_key in
           (select 'groceries:receipt:' || r.id from grocery.receipts r
              join grocery.merchants m on m.id = r.merchant_id where m.name like $1)`,
        [`${merchantName}%`],
      );
      await svc?.pool.query(
        `delete from grocery.receipts where merchant_id in
           (select id from grocery.merchants where name like $1)`,
        [`${merchantName}%`],
      );
      await svc?.pool.query(
        `delete from grocery.merchants where name like $1`,
        [`${merchantName}%`],
      );
      await svc?.close();
      await app?.close();
    });

    const receipt = {
      merchant: { name: merchantName, vatNumber: `IT${Date.now()}` },
      purchasedAt: '2026-10-23T18:42:00Z',
      currency: 'eur',
      total: 3.69,
      paymentMethod: 'card',
      items: [
        {
          rawName: 'LATTE INT 1L',
          normalizedName: 'Whole milk 1 L',
          category: 'dairy',
          quantity: 1,
          lineTotal: 1.49,
        },
        {
          rawName: 'PANE',
          normalizedName: 'Bread',
          category: 'bakery',
          quantity: 1,
          lineTotal: 2.2,
        },
      ],
    };

    function approved(payload: unknown, targetKey = 'grocery.receipt@1') {
      const record: RecordApprovedV1 = {
        recordId: randomUUID(),
        uploadId: randomUUID(),
        category: 'groceries',
        targetKey,
        payload,
        documentFields: { total: 3.69 },
        approvedAt: new Date().toISOString(),
      };
      return record;
    }

    async function deliver(record: RecordApprovedV1, eventId = randomUUID()) {
      const event: EventEnvelope = {
        id: eventId,
        type: 'record.approved@1',
        source: 'test',
        occurredAt: new Date().toISOString(),
        payload: record,
      };
      return processOnce(svc.pool, 'grocery', event.id, (client) =>
        handle(event, client),
      );
    }

    async function answers(recordId: string) {
      const { rows } = await svc.pool.query<{
        event_type: string;
        payload: { domainRecordId?: string; error?: string };
      }>(
        `select event_type, payload from grocery.outbox
          where payload->>'recordId' = $1 order by created_at`,
        [recordId],
      );
      return rows;
    }

    it('loads a confirmed receipt once, answers record.loaded, and serves it', async () => {
      const record = approved(receipt);
      const eventId = randomUUID();
      expect(await deliver(record, eventId)).toBe(true);
      // The same event redelivered, then the same record in a new event.
      expect(await deliver(record, eventId)).toBe(false);
      await deliver(record);

      const replies = await answers(record.recordId);
      expect(replies.map((row) => row.event_type)).toEqual([
        'record.loaded@1',
        'record.loaded@1',
      ]);
      const receiptId = replies[0].payload.domainRecordId!;
      expect(replies[1].payload.domainRecordId).toBe(receiptId);

      const page = (await (
        await fetch(`${base}/receipts?from=2026-10-23&to=2026-10-23`)
      ).json()) as Page<ReceiptDto>;
      const listed = page.items.filter((item) => item.id === receiptId);
      expect(listed).toHaveLength(1);
      expect(listed[0]).toMatchObject({
        currency: 'EUR',
        total: 3.69,
        itemCount: 2,
        merchant: { name: merchantName },
      });

      const detail = (await (
        await fetch(`${base}/receipts/${receiptId}`)
      ).json()) as ReceiptDetailDto;
      expect(detail.items.map((item) => item.normalizedName)).toEqual([
        'Whole milk 1 L',
        'Bread',
      ]);
      expect(detail.documentFields).toEqual({ total: 3.69 });

      // A second receipt from the same shop reuses the merchant.
      const again = approved({
        ...receipt,
        total: 1.49,
        items: [receipt.items[0]],
      });
      await deliver(again);
      const second = (await answers(again.recordId))[0].payload.domainRecordId!;
      const secondDetail = (await (
        await fetch(`${base}/receipts/${second}`)
      ).json()) as ReceiptDetailDto;
      expect(secondDetail.merchant.id).toBe(detail.merchant.id);
    });

    it('answers record.load_failed for a payload that does not fit, and ignores other targets', async () => {
      const broken = approved({ ...receipt, total: 99 });
      await deliver(broken);
      const [reply] = await answers(broken.recordId);
      expect(reply.event_type).toBe('record.load_failed@1');
      expect(reply.payload.error).toContain('line totals');

      const other = approved({}, 'tax730.expense@1');
      await deliver(other);
      expect(await answers(other.recordId)).toEqual([]);
    });

    it('lists the receipts for Money, cash apart, and shows the matched payment', async () => {
      const card = approved({
        ...receipt,
        purchasedAt: '2026-09-11T08:15:00Z',
      });
      const cash = approved({
        ...receipt,
        purchasedAt: '2026-09-11T09:15:00Z',
        paymentMethod: 'cash',
      });
      await deliver(card);
      await deliver(cash);
      const cardId = (await answers(card.recordId))[0].payload.domainRecordId!;
      const cashId = (await answers(cash.recordId))[0].payload.domainRecordId!;

      // A movement booked 3 days later still finds it; the cash one, never.
      const payables = (await (
        await fetch(`${base}/payables?from=2026-09-14&to=2026-09-14`)
      ).json()) as PayableDto[];
      const mine = payables.find(
        (p) => p.key === `groceries:receipt:${cardId}`,
      );
      expect(mine).toMatchObject({
        module: 'groceries',
        kind: 'receipt',
        amount: 3.69,
        direction: 'out',
        date: '2026-09-11',
        window: { from: '2026-09-10', to: '2026-09-16' },
        payees: [merchantName],
      });
      expect(payables.some((p) => p.key.endsWith(cashId))).toBe(false);
      expect(mine?.lines?.length).toBe(receipt.items.length);

      // Cash is listed on its day only, for Money to add to your cash.
      const onTheDay = (await (
        await fetch(`${base}/payables?from=2026-09-11&to=2026-09-11`)
      ).json()) as PayableDto[];
      expect(
        onTheDay.find((p) => p.key === `groceries:receipt:${cashId}`),
      ).toMatchObject({
        paidInCash: true,
        window: { from: '2026-09-11', to: '2026-09-11' },
      });
      expect(
        (await fetch(`${base}/payables?from=2026-09-30&to=2026-09-01`)).status,
      ).toBe(400);

      const pay = (type: string, payload: unknown) =>
        processOnce(svc.pool, 'grocery', randomUUID(), (client) =>
          paymentEventHandler('grocery', 'groceries')(
            {
              id: randomUUID(),
              type,
              source: 'test',
              occurredAt: new Date().toISOString(),
              payload,
            },
            client,
          ),
        );
      const linkId = randomUUID();
      await pay('money.payment_linked@1', {
        linkId,
        payableKey: mine!.key,
        module: 'groceries',
        movementId: randomUUID(),
        date: '2026-09-12',
        amount: 3.69,
        accountName: 'Carta',
        description: 'PAGAMENTO POS',
        linkedAt: new Date().toISOString(),
      });
      const detail = async () =>
        (await (
          await fetch(`${base}/receipts/${cardId}`)
        ).json()) as ReceiptDetailDto;
      expect((await detail()).bankPayment).toEqual({
        paid: 3.69,
        full: true,
        lastDate: '2026-09-12',
        accounts: ['Carta'],
      });
      const page = (await (
        await fetch(`${base}/receipts?from=2026-09-11&to=2026-09-11`)
      ).json()) as Page<ReceiptDto>;
      expect(page.items.find((r) => r.id === cardId)?.bankPayment?.full).toBe(
        true,
      );
      expect(page.items.find((r) => r.id === cashId)?.bankPayment).toBeNull();

      await pay('money.payment_unlinked@1', {
        linkId,
        payableKey: mine!.key,
        module: 'groceries',
        reason: 'undone',
        unlinkedAt: new Date().toISOString(),
      });
      expect((await detail()).bankPayment).toBeNull();
    });
  },
);
