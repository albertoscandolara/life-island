import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import {
  createServiceDb,
  processOnce,
  type ServiceDb,
} from '@life-island/be-common';
import type {
  CarsOverviewDto,
  EventEnvelope,
  PendingCarReviewDto,
  VehicleDto,
} from '@life-island/contracts';
import { randomUUID } from 'node:crypto';
import { createApp } from './bootstrap.js';
import { loadConfig } from './config.js';
import { applyDocumentEvent } from './documents/document-events.handler.js';

// Needs the compose stack: `npm run infra:up`, then `npm run test:integration`.
const configured = !!process.env['CARS_DATABASE_URL'];

describe.skipIf(!configured)(
  'Cars (car documents → cars, review, new car suggestions, renewals and costs over HTTP)',
  () => {
    let app: INestApplication;
    let base: string;
    let svc: ServiceDb;
    // Plates and VINs of this run only, so it never matches another run's cars.
    const run = Math.random().toString(36).slice(2, 7).toUpperCase();
    const plate = `AB${run}`;
    const otherPlate = `ZZ${run}`;
    const vin = `ZFA3120000${run}00`.slice(0, 17);
    const uploads: string[] = [];

    beforeAll(async () => {
      const config = { ...loadConfig(), port: 0 };
      app = await createApp(config, { events: false });
      await app.listen(0);
      base = (await app.getUrl()).replace('[::1]', 'localhost');
      svc = createServiceDb({
        connectionString: config.databaseUrl,
        schema: 'cars',
      });
      // The categories of svc-ingestion's migration 0013.
      for (const [id, parentId] of [
        ['CAR_DOCUMENT', null],
        ['VEHICLE_REGISTRATION', 'CAR_DOCUMENT'],
        ['CAR_INSURANCE', 'CAR_DOCUMENT'],
        ['ROAD_TAX', 'CAR_DOCUMENT'],
        ['VEHICLE_INSPECTION', 'CAR_DOCUMENT'],
        ['VEHICLE_EXPENSE', 'CAR_DOCUMENT'],
      ])
        await deliver('category.changed@1', {
          id,
          title: id,
          parentId,
          dimension: 'DOCUMENT_TYPE',
          deleted: false,
          changedAt: new Date().toISOString(),
        });
    });

    afterAll(async () => {
      if (uploads.length) {
        await svc?.pool.query(
          'delete from cars.reviews where upload_id = any($1)',
          [uploads],
        );
        await svc?.pool.query(
          'delete from cars.documents where upload_id = any($1)',
          [uploads],
        );
      }
      await svc?.pool.query(
        "delete from cars.vehicles where values->>'registrationNumber' = any($1)",
        [[plate, otherPlate]],
      );
      await svc?.close();
      await app?.close();
    });

    async function deliver(type: string, payload: unknown) {
      const event: EventEnvelope = {
        id: randomUUID(),
        type,
        source: 'test',
        occurredAt: new Date().toISOString(),
        payload,
      };
      await processOnce(svc.pool, 'cars', event.id, (client) =>
        applyDocumentEvent(event, client),
      );
    }

    async function upload(
      categories: string[],
      fields: Record<string, string | number | boolean | null>,
    ) {
      const uploadId = randomUUID();
      uploads.push(uploadId);
      await deliver('upload.updated@1', {
        uploadId,
        title: `${categories[0]} ${run}`,
        description: null,
        originalFilename: 'scan.pdf',
        fileFormat: 'PDF',
        uploadedAt: new Date().toISOString(),
        categories,
        suggestedCategories: [],
        fields,
        updatedAt: new Date().toISOString(),
      });
      return uploadId;
    }

    const json = async <T>(response: Response): Promise<T> => {
      if (!response.ok)
        throw new Error(`${response.status}: ${await response.text()}`);
      return (await response.json()) as T;
    };
    const send = (method: string, path: string, body?: unknown) =>
      fetch(`${base}${path}`, {
        method,
        headers: { 'content-type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    const overview = async () =>
      json<CarsOverviewDto>(await send('GET', '/overview'));
    const review = async (uploadId: string) =>
      (await overview()).reviews.find(
        (r) => r.uploadId === uploadId,
      ) as PendingCarReviewDto;
    const car = async (id: string) =>
      (await overview()).vehicles.find((v) => v.id === id) as VehicleDto;
    const day = (offset: number) =>
      new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);

    let vehicleId: string;

    it('holds a new car from its registration certificate and creates it on approval', async () => {
      const libretto = await upload(['VEHICLE_REGISTRATION'], {
        registration_number: plate,
        first_registration_date: day(-365),
        make: 'FIAT',
        commercial_name: 'PANDA',
        vin,
        engine_capacity_cc: '1.242',
        fuel: 'petrol',
        document_number: `CC${run}`,
        issue_date: day(-365),
      });
      const pending = await review(libretto);
      expect(pending).toMatchObject({
        type: 'VEHICLE_REGISTRATION',
        vehicleId: null,
        match: 'none',
        registrationNumber: plate,
      });
      expect(
        pending.changes.find((c) => c.field === 'engine.capacityCc'),
      ).toMatchObject({
        code: 'P.1',
        proposed: 1242,
      });

      const approved = await send('POST', `/reviews/${libretto}/approve`, {
        vehicleId: null,
        label: 'Panda',
      });
      expect(approved.status).toBe(204);
      const all = await overview();
      const created = all.vehicles.find(
        (v) => v.values.registrationNumber === plate,
      );
      expect(created).toMatchObject({
        label: 'Panda',
        status: 'active',
        values: expect.objectContaining({
          vin,
          make: 'FIAT',
          'engine.fuelKey': 'petrol',
        }),
      });
      vehicleId = created?.id ?? '';
      // No insurance and no road tax yet: both say so.
      expect(created?.alerts.map((a) => [a.kind, a.level])).toEqual([
        ['insurance', 'missing'],
        ['road_tax', 'missing'],
      ]);
      expect(created?.series[0]).toMatchObject({
        type: 'VEHICLE_REGISTRATION',
      });
    });

    it('matches an insurance policy by plate and warns before it expires', async () => {
      const policy = await upload(['CAR_INSURANCE'], {
        registration_number: plate.toLowerCase(),
        insurer: 'ASSICURA SPA',
        policy_number: `P${run}`,
        start_date: day(-340),
        end_date: day(25),
        total_amount: 328.5,
        payment_date: day(-340),
      });
      const pending = await review(policy);
      expect(pending).toMatchObject({
        vehicleId,
        match: 'registration_number',
        changes: [],
      });
      expect(
        (await send('POST', `/reviews/${policy}/approve`, { vehicleId }))
          .status,
      ).toBe(204);
      const updated = await car(vehicleId);
      expect(
        updated.renewals.find((r) => r.kind === 'insurance'),
      ).toMatchObject({
        level: 'expiring',
        daysLeft: 25,
        uploadId: policy,
      });
      expect(updated.costs).toEqual([
        expect.objectContaining({ kind: 'insurance', amount: 328.5 }),
      ]);
    }, 10_000);

    it('makes one record of the certificate and receipt of that policy', async () => {
      const policy = (await car(vehicleId)).series.find(
        (s) => s.type === 'CAR_INSURANCE',
      )?.versions[0].uploadId as string;
      const certificate = await upload(['CAR_INSURANCE'], {
        registration_number: plate,
        policy_number: `P${run}`,
        end_date: day(25),
        document_kind: 'certificate',
      });
      const receipt = await upload(['CAR_INSURANCE'], {
        registration_number: plate,
        policy_number: `p ${run}`,
        total_amount: 328.5,
        payment_date: day(-340),
        document_kind: 'receipt',
      });
      expect(await review(receipt)).toMatchObject({
        role: 'receipt',
        joins: { uploadId: policy, number: `p ${run}`, documentCount: 1 },
      });
      for (const id of [certificate, receipt])
        expect(
          (await send('POST', `/reviews/${id}/approve`, { vehicleId })).status,
        ).toBe(204);

      let updated = await car(vehicleId);
      let versions = updated.series.find(
        (s) => s.type === 'CAR_INSURANCE',
      )!.versions;
      expect(versions).toHaveLength(1);
      expect(versions[0].documents.map((d) => [d.uploadId, d.role])).toEqual([
        [policy, null],
        [certificate, 'certificate'],
        [receipt, 'receipt'],
      ]);
      // The premium is on the policy and on its receipt: paid once.
      expect(updated.costs.filter((c) => c.kind === 'insurance')).toEqual([
        expect.objectContaining({ uploadId: receipt, amount: 328.5 }),
      ]);

      // Out of the record by hand, and back in.
      expect(
        (
          await send('PUT', `/documents/${certificate}/group`, {
            attachTo: null,
          })
        ).status,
      ).toBe(204);
      versions = (await car(vehicleId)).series.find(
        (s) => s.type === 'CAR_INSURANCE',
      )!.versions;
      expect(versions).toHaveLength(2);
      expect(
        (
          await send('PUT', `/documents/${certificate}/group`, {
            attachTo: receipt,
          })
        ).status,
      ).toBe(204);
      updated = await car(vehicleId);
      versions = updated.series.find(
        (s) => s.type === 'CAR_INSURANCE',
      )!.versions;
      expect(versions).toHaveLength(1);
      expect(
        versions[0].documents.find((d) => d.uploadId === certificate)
          ?.linkedByHand,
      ).toBe(true);
      // Never into a record of another kind.
      const bollo = updated.series.find((s) => s.type === 'ROAD_TAX');
      expect(bollo).toBeUndefined();
      expect(
        (
          await send('PUT', `/documents/${certificate}/group`, {
            attachTo: randomUUID(),
          })
        ).status,
      ).toBe(422);
    });

    it('suggests a new car when a document names a plate you do not have', async () => {
      const bollo = await upload(['ROAD_TAX'], {
        registration_number: otherPlate,
        expiry_month: day(200).slice(0, 7),
        total_amount: 180,
      });
      const pending = await review(bollo);
      expect(pending).toMatchObject({ vehicleId: null, match: 'none' });
      expect(pending.changes).toEqual([
        expect.objectContaining({
          field: 'registrationNumber',
          proposed: otherPlate,
        }),
      ]);
      // A misread plate: you file it under your car instead.
      expect(
        (
          await send('POST', `/reviews/${bollo}/approve`, {
            vehicleId,
            accept: [],
          })
        ).status,
      ).toBe(204);
      const updated = await car(vehicleId);
      expect(updated.values.registrationNumber).toBe(plate);
      expect(updated.renewals.find((r) => r.kind === 'road_tax')?.level).toBe(
        'ok',
      );
    });

    it('files a receipt without a plate only under a car you pick', async () => {
      const fuel = await upload(['VEHICLE_EXPENSE'], {
        expense_kind: 'fuel',
        expense_date: day(-2),
        litres: '29,94',
        total_amount: 52.4,
        odometer_km: 48210,
      });
      const refused = await send('POST', `/reviews/${fuel}/approve`, {
        vehicleId: null,
      });
      expect(refused.status).toBe(422);
      expect(
        (await send('POST', `/reviews/${fuel}/approve`, { vehicleId })).status,
      ).toBe(204);
      const updated = await car(vehicleId);
      expect(updated.odometerKm).toBe(48210);
      expect(updated.costs[0]).toMatchObject({ kind: 'fuel', litres: 29.94 });
    });

    it('rejects, reopens, cancels and edits', async () => {
      const stray = await upload(['CAR_DOCUMENT'], {
        registration_number: null,
      });
      expect((await send('POST', `/reviews/${stray}/reject`)).status).toBe(204);
      expect(
        (await overview()).rejected.some((r) => r.uploadId === stray),
      ).toBe(true);
      expect((await send('POST', `/reviews/${stray}/reopen`)).status).toBe(204);
      expect(await review(stray)).toBeTruthy();

      const policy = (await car(vehicleId)).series.find(
        (s) => s.type === 'CAR_INSURANCE',
      )?.versions[0].uploadId as string;
      expect(
        (await send('PATCH', `/documents/${policy}`, { status: 'cancelled' }))
          .status,
      ).toBe(204);
      expect(
        (await car(vehicleId)).renewals.find((r) => r.kind === 'insurance')
          ?.level,
      ).toBe('missing');

      expect(
        (
          await send('PATCH', `/vehicles/${vehicleId}`, {
            label: 'Old Panda',
            values: { colour: 'GRIGIO', seatCount: 4 },
          })
        ).status,
      ).toBe(204);
      expect((await car(vehicleId)).values).toMatchObject({
        colour: 'GRIGIO',
        seatCount: 4,
      });
      expect(
        (await send('POST', '/vehicles', { registrationNumber: plate })).status,
      ).toBe(409);
    });

    it.skipIf(!process.env['S3_ENDPOINT'])(
      'keeps a 3D model per car in its own bucket',
      async () => {
        const glb = Buffer.concat([
          Buffer.from('glTF', 'latin1'),
          Buffer.alloc(16, 1),
        ]);
        const put = (filename: string, body: Buffer | string) =>
          fetch(`${base}/vehicles/${vehicleId}/model?filename=${filename}`, {
            method: 'PUT',
            headers: { 'content-type': 'application/octet-stream' },
            body,
          });
        expect((await put('panda.glb', glb)).status).toBe(204);
        expect((await car(vehicleId)).model).toMatchObject({
          filename: 'panda.glb',
          format: 'GLB',
          sizeBytes: glb.length,
        });
        const file = await fetch(`${base}/vehicles/${vehicleId}/model`);
        expect(file.headers.get('content-type')).toBe('model/gltf-binary');
        expect(Buffer.from(await file.arrayBuffer()).equals(glb)).toBe(true);
        expect((await put('panda.obj', 'not a model')).status).toBe(400);
        expect(
          (await send('DELETE', `/vehicles/${vehicleId}/model`)).status,
        ).toBe(204);
        expect((await car(vehicleId)).model).toBeNull();
      },
    );

    it('sends the documents of a removed car back to review', async () => {
      expect((await send('DELETE', `/vehicles/${vehicleId}`)).status).toBe(204);
      const all = await overview();
      expect(all.vehicles.some((v) => v.id === vehicleId)).toBe(false);
      const back = all.reviews.filter((r) => uploads.includes(r.uploadId));
      expect(back.length).toBeGreaterThanOrEqual(4);
    });
  },
);
