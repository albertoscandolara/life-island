import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import { createServiceDb, type ServiceDb } from '@life-island/be-common';
import {
  isoAddDays,
  type DeadlineDto,
  type TravelOverviewDto,
  type TripPlanDto,
} from '@life-island/contracts';
import { createApp } from './bootstrap.js';
import { loadConfig } from './config.js';
import { today } from './travel/travel.service.js';

// Needs the compose stack: `npm run infra:up`, then `npm run test:integration`.
const configured = !!process.env['TRAVEL_DATABASE_URL'];

describe.skipIf(!configured)(
  'Travel (trips, bookings, planner over HTTP)',
  () => {
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
        schema: 'travel',
      });
    });

    afterAll(async () => {
      for (const id of ids)
        await svc?.pool.query('delete from travel.trips where id = $1', [id]);
      await svc?.close();
      await app?.close();
    });

    it('keeps a trip with its bookings and expenses, plans it and sends its dates to the agenda', async () => {
      const day = today();
      const trip = await json<{ id: string }>('POST', '/trips', {
        title: 'Test Lisbon',
        destination: 'Lisbon',
        startOn: isoAddDays(day, 40),
        endOn: isoAddDays(day, 44),
        status: 'booked',
      });
      expect(trip.status).toBe(201);
      ids.push(trip.body.id);
      await json('POST', '/bookings', {
        tripId: trip.body.id,
        kind: 'stay',
        title: 'Hotel Alfama',
        cost: 400,
        cancelBy: isoAddDays(day, 30),
      });
      await json('POST', '/expenses', {
        tripId: trip.body.id,
        date: day,
        amount: 25.5,
        category: 'food',
      });

      const plan = await json<TripPlanDto>(
        'POST',
        `/trips/${trip.body.id}/plans`,
        {},
      );
      expect(plan.status).toBe(201);
      expect(plan.body.source).toBe('offline');
      expect(plan.body.output.days).toHaveLength(5);
      const applied = await json<{ added: number }>(
        'POST',
        `/plans/${plan.body.id}/apply`,
        {},
      );
      expect(applied.body.added).toBe(
        plan.body.output.checklist.length + plan.body.output.packing.length,
      );
      expect(
        (
          await json<{ added: number }>(
            'POST',
            `/plans/${plan.body.id}/apply`,
            {},
          )
        ).body.added,
      ).toBe(0);

      const overview = await json<TravelOverviewDto>('GET', '/overview');
      const mine = overview.body.trips.find((t) => t.id === trip.body.id)!;
      expect(mine).toMatchObject({ nights: 4, daysToGo: 40, spent: 425.5 });
      expect(mine.checklist.some((c) => c.packing)).toBe(true);

      const deadlines = await json<DeadlineDto[]>('GET', '/deadlines');
      const kinds = new Set(
        deadlines.body
          .filter(
            (d) =>
              d.path === '/travel' &&
              (d.title.includes('Lisbon') || d.title.includes('Hotel Alfama')),
          )
          .map((d) => d.kind),
      );
      expect([...kinds].sort()).toEqual(['departure', 'free-cancellation']);
      expect(
        deadlines.body.some(
          (d) => d.kind === 'trip-task' && d.detail === 'Before Test Lisbon.',
        ),
      ).toBe(true);
    });
  },
);
