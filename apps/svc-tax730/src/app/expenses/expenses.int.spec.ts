import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import {
  createServiceDb,
  processOnce,
  recordApprovedHandler,
  type ServiceDb,
} from '@life-island/be-common';
import type {
  EventEnvelope,
  ExpenseDto,
  Page,
  RecordApprovedV1,
  TaxYearDto,
} from '@life-island/contracts';
import { randomUUID } from 'node:crypto';
import { createApp } from '../bootstrap.js';
import { loadConfig } from '../config.js';
import { expenseLoader } from './expense-loader.js';

// Needs the compose stack: `npm run infra:up`, then `npm run test:integration`.
const configured = !!process.env['TAX730_DATABASE_URL'];

describe.skipIf(!configured)(
  '730 expenses (record.approved → expenses → HTTP)',
  () => {
    let app: INestApplication;
    let base: string;
    let svc: ServiceDb;
    // A year of its own, so totals are not mixed with other runs' data.
    const taxYear = 2000 + Math.floor(Math.random() * 90);
    const handle = recordApprovedHandler('tax730', expenseLoader);

    beforeAll(async () => {
      const config = { ...loadConfig(), port: 0 };
      app = await createApp(config, { events: false });
      await app.listen(0);
      base = (await app.getUrl()).replace('[::1]', 'localhost');
      svc = createServiceDb({
        connectionString: config.databaseUrl,
        schema: 'tax730',
      });
      await svc.pool.query(`delete from tax730.expenses where tax_year = $1`, [
        taxYear,
      ]);
    });

    afterAll(async () => {
      await svc?.pool.query(`delete from tax730.expenses where tax_year = $1`, [
        taxYear,
      ]);
      await svc?.close();
      await app?.close();
    });

    const expense = (overrides: object = {}) => ({
      taxYear,
      expenseType: 'medicines',
      date: `${taxYear}-03-02`,
      amount: 12.5,
      issuer: 'Farmacia Centrale',
      traceablePayment: true,
      beneficiaryFiscalCode: 'RSSMRA85T10A562S',
      ...overrides,
    });

    async function deliver(payload: unknown) {
      const record: RecordApprovedV1 = {
        recordId: randomUUID(),
        uploadId: randomUUID(),
        category: 'tax730',
        targetKey: 'tax730.expense@1',
        payload,
        approvedAt: new Date().toISOString(),
      };
      const event: EventEnvelope = {
        id: randomUUID(),
        type: 'record.approved@1',
        source: 'test',
        occurredAt: new Date().toISOString(),
        payload: record,
      };
      await processOnce(svc.pool, 'tax730', event.id, (client) =>
        handle(event, client),
      );
      const { rows } = await svc.pool.query<{
        event_type: string;
        payload: { domainRecordId?: string; error?: string };
      }>(
        `select event_type, payload from tax730.outbox
          where payload->>'recordId' = $1`,
        [record.recordId],
      );
      return rows[0];
    }

    it('loads expenses and totals them per tax year', async () => {
      const first = await deliver(expense());
      expect(first.event_type).toBe('record.loaded@1');
      await deliver(
        expense({
          expenseType: 'medical',
          amount: 80,
          traceablePayment: false,
        }),
      );
      await deliver(expense({ amount: 7.5 }));

      const page = (await (
        await fetch(`${base}/expenses?taxYear=${taxYear}`)
      ).json()) as Page<ExpenseDto>;
      expect(page.total).toBe(3);

      const years = (await (
        await fetch(`${base}/tax-years`)
      ).json()) as TaxYearDto[];
      const year = years.find((entry) => entry.taxYear === taxYear);
      expect(year).toMatchObject({
        total: 100,
        expenseCount: 3,
        untraceableCount: 1,
      });
      expect(year?.byType).toEqual([
        { expenseType: 'medical', total: 80, count: 1 },
        { expenseType: 'medicines', total: 20, count: 2 },
      ]);
    });

    it('answers record.load_failed for an invalid codice fiscale, storing nothing', async () => {
      const reply = await deliver(
        expense({ beneficiaryFiscalCode: 'NOT-A-CODE' }),
      );
      expect(reply.event_type).toBe('record.load_failed@1');
      expect(reply.payload.error).toContain('codice fiscale');
      const mismatched = await deliver(expense({ date: '1999-01-01' }));
      expect(mismatched.event_type).toBe('record.load_failed@1');
    });
  },
);
