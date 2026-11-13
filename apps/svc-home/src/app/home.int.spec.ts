import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import {
  createServiceDb,
  processOnce,
  type ServiceDb,
} from '@life-island/be-common';
import type {
  BillDto,
  EntityRefDto,
  EventEnvelope,
  HouseSuggestionDto,
  KnownCompanyDto,
  OrganizationDetailDto,
  OrganizationDto,
  PropertyDto,
  SupplyPointDto,
  WorkDto,
} from '@life-island/contracts';
import { randomUUID } from 'node:crypto';
import { createApp } from './bootstrap.js';
import { loadConfig } from './config.js';
import { applyDocumentEvent } from './documents/document-events.handler.js';

// Needs the compose stack: `npm run infra:up`, then `npm run test:integration`.
const configured = !!process.env['HOME_DATABASE_URL'];

describe.skipIf(!configured)(
  'Home (documents → bills, properties and works over HTTP)',
  () => {
    let app: INestApplication;
    let base: string;
    let svc: ServiceDb;
    // Words of this run only, so bills never match another run's homes.
    const run = Math.random().toString(36).slice(2, 8);
    /** 8 digits of this run, for PDRs (14 digits) of its own. */
    const runDigits = String(Date.now()).slice(-8);
    const createdProperties: string[] = [];
    const uploads: string[] = [];

    beforeAll(async () => {
      const config = {
        ...loadConfig(),
        port: 0,
        linkPropertyCategories: false,
      };
      app = await createApp(config, { events: false });
      await app.listen(0);
      base = (await app.getUrl()).replace('[::1]', 'localhost');
      svc = createServiceDb({
        connectionString: config.databaseUrl,
        schema: 'home',
      });
    });

    afterAll(async () => {
      for (const id of createdProperties)
        await svc?.pool.query('delete from home.properties where id = $1', [
          id,
        ]);
      if (uploads.length) {
        await svc?.pool.query(
          'delete from home.bill_overrides where upload_id = any($1)',
          [uploads],
        );
        await svc?.pool.query(
          'delete from home.house_reviews where upload_id = any($1)',
          [uploads],
        );
        await svc?.pool.query(
          'delete from home.documents where upload_id = any($1)',
          [uploads],
        );
        await svc?.pool.query(
          'delete from home.bills where upload_id = any($1)',
          [uploads],
        );
        await svc?.pool.query(
          "delete from home.supply_points where code ilike '%' || $1 || '%'",
          [run],
        );
        await svc?.pool.query(
          "delete from home.organizations where name ilike '%' || $1 || '%'",
          [run],
        );
      }
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
      await processOnce(svc.pool, 'home', event.id, (client) =>
        applyDocumentEvent(event, client),
      );
    }

    async function upload(
      categories: string[],
      fields: Record<string, string | number | null>,
      title = 'Bill',
    ) {
      const uploadId = randomUUID();
      uploads.push(uploadId);
      await deliver('upload.updated@1', {
        uploadId,
        title,
        description: null,
        originalFilename: 'bill.pdf',
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

    async function createProperty(name: string, extra: object = {}) {
      const property = await json<PropertyDto>(
        await send('POST', '/properties', { name, ...extra }),
      );
      createdProperties.push(property.id);
      return property;
    }

    it('creates properties with their own colour and match terms', async () => {
      const first = await createProperty(`Via Alfa${run}`);
      expect(first.matchTerms).toEqual([`alfa${run}`]);
      const list = await json<PropertyDto[]>(await send('GET', '/properties'));
      const slots = list.map((p) => p.colorSlot);
      expect(new Set(slots).size).toBe(slots.length);
    });

    it('reads bills from documents and assigns them to their home', async () => {
      const alfa = await createProperty(`Casa A${run}`, {
        matchTerms: [`strada a${run}`],
      });
      const beta = await createProperty(`Casa B${run}`, {
        supplyCodes: [`IT001E${run}`],
      });
      // A subcategory of GAS_BILL still counts as gas.
      await deliver('category.changed@1', {
        id: `HERA_${run.toUpperCase()}`,
        title: `Hera ${run}`,
        parentId: 'GAS_BILL',
        dimension: null,
        deleted: false,
        changedAt: new Date().toISOString(),
      });
      const gas = await upload([`HERA_${run.toUpperCase()}`], {
        billing_period: '2026-01-01/2026-02-28',
        gas_consumption: '210',
        total_amount: '180,40',
        supply_address: `Strada A${run} 4, Verona`,
      });
      const power = await upload(['ELECTRICITY_BILL'], {
        customer_id: `it001e ${run}`,
        issue_date: '2026-03-10',
        electricity_consumption: 320,
        total_amount: 95.1,
      });
      await upload(['INVOICE'], { total_amount: 50 }, 'Not a bill');

      const bills = await json<BillDto[]>(
        await send('GET', `/bills?from=2026-01-01&to=2026-12-31`),
      );
      const byId = new Map(bills.map((bill) => [bill.uploadId, bill]));
      expect(byId.get(gas)).toMatchObject({
        utility: 'GAS',
        propertyId: alfa.id,
        assignment: 'ADDRESS',
        amount: 180.4,
        consumption: 210,
        periodStart: '2026-01-01',
      });
      expect(byId.get(power)).toMatchObject({
        utility: 'ELECTRICITY',
        propertyId: beta.id,
        assignment: 'SUPPLY_CODE',
      });
      expect(
        bills.every((bill) =>
          uploads.includes(bill.uploadId) ? bill.title !== 'Not a bill' : true,
        ),
      ).toBe(true);

      const onlyBeta = await json<BillDto[]>(
        await send('GET', `/bills?property=${beta.id}&utility=ELECTRICITY`),
      );
      expect(onlyBeta.map((bill) => bill.uploadId)).toEqual([power]);
    });

    it('keeps your corrections to a bill', async () => {
      const home = await createProperty(`Casa C${run}`);
      const uploadId = await upload(['WATER_BILL'], {
        issue_date: '2026-05-02',
        total_amount: 40,
      });
      const moved = await json<{ bill: BillDto }>(
        await send('PATCH', `/bills/${uploadId}`, {
          propertyId: home.id,
          utility: 'GAS',
        }),
      );
      expect(moved.bill).toMatchObject({
        propertyId: home.id,
        assignment: 'MANUAL',
        utility: 'GAS',
        utilityOverridden: true,
      });
      const excluded = await json<{ bill: BillDto | null }>(
        await send('PATCH', `/bills/${uploadId}`, { excluded: true }),
      );
      expect(excluded.bill).toBeNull();
      const bills = await json<BillDto[]>(await send('GET', '/bills'));
      expect(bills.some((bill) => bill.uploadId === uploadId)).toBe(false);
    });

    it('learns the supply code of a bill you put on a home', async () => {
      const home = await createProperty(`Casa L${run}`);
      const pdr = `0099${runDigits}77`;
      const first = await upload(['GAS_BILL'], {
        customer_id: pdr,
        issue_date: '2026-06-02',
        total_amount: 61.2,
      });
      await send('PATCH', `/bills/${first}`, { propertyId: home.id });
      const list = await json<PropertyDto[]>(await send('GET', '/properties'));
      expect(list.find((p) => p.id === home.id)?.supplyCodes).toEqual([pdr]);
      // The next bill of that supply finds its home by itself.
      const next = await upload(['GAS_BILL'], {
        customer_id: pdr,
        issue_date: '2026-08-02',
        total_amount: 48.9,
      });
      const bills = await json<BillDto[]>(await send('GET', '/bills'));
      expect(bills.find((bill) => bill.uploadId === next)).toMatchObject({
        propertyId: home.id,
        assignment: 'SUPPLY_CODE',
      });
    });

    it('keeps bills as entities: supplier, supply point and contract', async () => {
      const pod = `IT001E${run.toUpperCase()}99`;
      const first = await createProperty(`Casa E${run}`, {
        supplyCodes: [pod],
      });
      const second = await createProperty(`Casa F${run}`);
      const taxCode = String(Math.floor(Math.random() * 1e11)).padStart(
        11,
        '0',
      );
      const supplier = `Lene ${run}`;
      const january = await upload(['ELECTRICITY_BILL'], {
        provider: `${supplier} S.p.A.`,
        supplier_tax_code: `IT ${taxCode}`,
        supply_point_code: pod,
        customer_code: '1000007483',
        invoice_number: `F-${run}-1`,
        offer_name: 'Old offer',
        billing_period: '2026-01-01/2026-01-31',
        total_amount: 70,
      });
      // Printed without the tax code and with another legal form: the same company.
      const february = await upload(['ELECTRICITY_BILL'], {
        provider: `${supplier.toUpperCase()} spa`,
        supply_point_code: pod.toLowerCase(),
        customer_code: '1000007483',
        invoice_number: `F-${run}-2`,
        offer_name: 'New offer',
        billing_period: '2026-02-01/2026-02-28',
        total_amount: 60,
      });
      // The January invoice uploaded again: counted once.
      const copy = await upload(['ELECTRICITY_BILL'], {
        provider: `${supplier} S.p.A.`,
        supplier_tax_code: taxCode,
        supply_point_code: pod,
        invoice_number: `f-${run}-1`,
        billing_period: '2026-01-01/2026-01-31',
        total_amount: 70,
      });

      const bills = await json<BillDto[]>(await send('GET', '/bills'));
      const ours = bills.filter((b) =>
        ([january, february, copy] as string[]).includes(b.uploadId),
      );
      expect(ours.map((b) => b.uploadId).sort()).toEqual(
        [january, february].sort(),
      );
      const [a, b] = ours;
      expect(a.supplierId).toBeTruthy();
      expect(b.supplierId).toBe(a.supplierId);
      expect(b.supplyPointId).toBe(a.supplyPointId);
      expect(b.contractId).toBe(a.contractId);
      expect(ours.every((bill) => bill.propertyId === first.id)).toBe(true);
      expect(
        ours.find((bill) => bill.uploadId === january)?.invoiceNumber,
      ).toBe(`F-${run}-1`);

      const points = await json<SupplyPointDto[]>(
        await send('GET', '/supply-points'),
      );
      const point = points.find((p) => p.id === a.supplyPointId);
      if (!point) throw new Error('No supply point');
      expect(point).toMatchObject({
        utility: 'ELECTRICITY',
        code: pod,
        propertyId: first.id,
        billCount: 2,
      });
      expect(point.contracts).toEqual([
        expect.objectContaining({
          supplierName: `${supplier} S.p.A.`,
          customerCode: '1000007483',
          offerName: 'New offer',
          firstDay: '2026-01-01',
          lastDay: '2026-02-28',
          billCount: 2,
        }),
      ]);

      const orgs = await json<OrganizationDto[]>(
        await send('GET', '/organizations'),
      );
      expect(orgs.find((o) => o.id === a.supplierId)).toMatchObject({
        taxCode,
        roles: ['ENERGY_SUPPLIER'],
        billCount: 2,
      });
      const companies = await json<KnownCompanyDto[]>(
        await send('GET', '/companies'),
      );
      expect(companies.find((c) => c.id === a.supplierId)?.sources).toEqual(
        expect.arrayContaining(['ORGANIZATION', 'BILL']),
      );

      // Moving the supply point moves every bill of it, and its code.
      await json(
        await send('PATCH', `/supply-points/${point.id}`, {
          propertyId: second.id,
        }),
      );
      const moved = await json<BillDto[]>(
        await send('GET', `/bills?property=${second.id}`),
      );
      expect(moved.map((bill) => bill.uploadId).sort()).toEqual(
        [january, february].sort(),
      );
      const houses = await json<PropertyDto[]>(
        await send('GET', '/properties'),
      );
      expect(houses.find((h) => h.id === second.id)?.supplyCodes).toEqual([
        pod,
      ]);
      expect(houses.find((h) => h.id === first.id)?.supplyCodes).toEqual([]);
    });

    it('keeps customer codes on their supply contracts, never on the house', async () => {
      const pdr = `0177${runDigits}55`;
      const oldCode = `11${runDigits}`;
      const newCode = `22${runDigits}`;
      // An older review left the gas customer code on the house.
      const home = await createProperty(`Casa G${run}`, {
        supplyCodes: [oldCode],
      });
      const before = await upload(['GAS_BILL'], {
        provider: `Gas Uno ${run}`,
        supply_point_code: pdr,
        customer_code: oldCode,
        offer_name: 'Gas Fix',
        billing_period: '2026-01-01/2026-02-28',
        total_amount: 90,
      });
      await send('PATCH', `/bills/${before}`, { propertyId: home.id });
      // A new supplier on the same meter: a new contract with a new code.
      const after = await upload(['GAS_BILL'], {
        provider: `Gas Due ${run}`,
        supply_point_code: pdr,
        customer_code: newCode,
        billing_period: '2026-03-01/2026-04-30',
        total_amount: 80,
      });

      const houses = await json<PropertyDto[]>(
        await send('GET', '/properties'),
      );
      expect(houses.find((h) => h.id === home.id)?.supplyCodes).toEqual([pdr]);

      const bills = await json<BillDto[]>(await send('GET', '/bills'));
      expect(bills.find((b) => b.uploadId === after)?.propertyId).toBe(home.id);
      const points = await json<SupplyPointDto[]>(
        await send('GET', '/supply-points'),
      );
      const point = points.find((p) => p.code === pdr);
      expect(point?.contracts).toEqual([
        expect.objectContaining({
          customerCode: newCode,
          status: 'ACTIVE',
          firstDay: '2026-03-01',
          lastDay: '2026-04-30',
        }),
        expect.objectContaining({
          customerCode: oldCode,
          status: 'ENDED',
          offerName: 'Gas Fix',
          lastDay: '2026-02-28',
        }),
      ]);

      // The house review never offers a customer code.
      const suggestions = await json<HouseSuggestionDto[]>(
        await send('GET', '/houses/suggestions'),
      );
      const proposed = suggestions
        .filter((s) =>
          s.documents.some(
            (d) => d.uploadId === before || d.uploadId === after,
          ),
        )
        .flatMap((s) => s.changes.map((c) => c.proposed));
      expect(proposed.join(' ')).not.toContain(oldCode);
      expect(proposed.join(' ')).not.toContain(newCode);
    });

    it('tracks a work with its invoice', async () => {
      const home = await createProperty(`Casa D${run}`);
      const invoice = await upload(
        ['INVOICE'],
        {
          issue_date: '2026-04-01',
          total_amount: 1200,
        },
        'Plumber invoice',
      );
      const work = await json<WorkDto>(
        await send('POST', '/works', {
          propertyId: home.id,
          title: 'New boiler',
          kind: 'REPAIR',
          area: 'Boiler room',
          estimatedCost: 1500,
        }),
      );
      expect(work).toMatchObject({ status: 'PLANNED', documents: [] });

      const bad = await send('PATCH', `/works/${work.id}`, {
        startDate: '2026-05-01',
        endDate: '2026-04-01',
      });
      expect(bad.status).toBe(400);

      const done = await json<WorkDto>(
        await send('PATCH', `/works/${work.id}`, {
          status: 'DONE',
          actualCost: 1200,
          endDate: '2026-04-01',
        }),
      );
      expect(done).toMatchObject({ status: 'DONE', actualCost: 1200 });

      const withInvoice = await json<WorkDto>(
        await send('POST', `/works/${work.id}/documents`, {
          uploadId: invoice,
        }),
      );
      expect(withInvoice.documents).toEqual([
        {
          uploadId: invoice,
          title: 'Plumber invoice',
          date: '2026-04-01',
          amount: 1200,
          deleted: false,
        },
      ]);

      const list = await json<WorkDto[]>(
        await send('GET', `/works?property=${home.id}`),
      );
      expect(list.map((w) => w.id)).toEqual([work.id]);

      const removed = await send('DELETE', `/works/${work.id}`);
      expect(removed.status).toBe(204);
    });

    it('keeps a house with all its data, and only one residence', async () => {
      const first = await createProperty(`Casa R1${run}`, {
        isResidence: true,
        address: `Via Erre${run} 3`,
        postalCode: '37100',
        areaSqm: 92.5,
        owners: [{ personId: null, name: 'Mario Rossi', share: 50 }],
        gasSupplier: 'Magis Energia',
      });
      expect(first).toMatchObject({
        isResidence: true,
        areaSqm: 92.5,
        owners: [{ personId: null, name: 'Mario Rossi', share: 50 }],
        matchTerms: [`erre${run}`],
      });
      const second = await createProperty(`Casa R2${run}`);
      await json<PropertyDto>(
        await send('PATCH', `/properties/${second.id}`, { isResidence: true }),
      );
      const list = await json<PropertyDto[]>(await send('GET', '/properties'));
      expect(list.filter((p) => p.isResidence).map((p) => p.id)).toEqual([
        second.id,
      ]);
      const companies = await json<{ name: string }[]>(
        await send('GET', '/companies'),
      );
      expect(companies.map((c) => c.name)).toContain('Magis Energia');
    });

    it('suggests a new house from a bill, then new data for it', async () => {
      const street = `Via Zeta${run}`;
      const first = await upload(['GAS_BILL'], {
        provider: 'Magis Energia',
        customer_id: `0168${runDigits}01`,
        supply_address: `${street} 7, 37039 Tregnago (VR)`,
        billing_period: '2026-01-01/2026-02-28',
        total_amount: 120,
      });
      const mine = (list: HouseSuggestionDto[]) =>
        list.filter((s) =>
          s.documents.some((d) => uploads.includes(d.uploadId)),
        );

      const suggested = mine(
        await json<HouseSuggestionDto[]>(
          await send('GET', '/houses/suggestions'),
        ),
      );
      const fresh = suggested.find((s) => s.documents[0].uploadId === first);
      expect(fresh).toMatchObject({
        kind: 'new_house',
        name: `${street} 7`,
        propertyId: null,
      });
      expect(fresh?.changes.map((c) => c.field)).toEqual([
        'address',
        'postalCode',
        'city',
        'province',
        'gasSupplier',
        'supplyCodes',
      ]);

      const house = await json<PropertyDto>(
        await send('POST', '/houses/suggestions/approve', {
          uploadIds: [first],
          propertyId: null,
          accept: ['address', 'city', 'gasSupplier', 'supplyCodes'],
        }),
      );
      createdProperties.push(house.id);
      expect(house).toMatchObject({
        name: `${street} 7`,
        address: `${street} 7`,
        city: 'Tregnago',
        postalCode: null,
        gasSupplier: 'Magis Energia',
        supplyCodes: [`0168${runDigits}01`],
      });

      // A newer bill of the same house, from a new supplier.
      const second = await upload(['GAS_BILL'], {
        provider: 'Hera Comm',
        customer_id: `0168${runDigits}01`,
        billing_period: '2026-03-01/2026-04-30',
        total_amount: 90,
      });
      const after = mine(
        await json<HouseSuggestionDto[]>(
          await send('GET', '/houses/suggestions'),
        ),
      );
      expect(
        after.some((s) => s.documents.some((d) => d.uploadId === first)),
      ).toBe(false);
      const info = after.find((s) => s.documents[0].uploadId === second);
      expect(info).toMatchObject({
        kind: 'new_info',
        propertyId: house.id,
        changes: [
          {
            field: 'gasSupplier',
            kind: 'different_value',
            current: 'Magis Energia',
            proposed: 'Hera Comm',
          },
        ],
      });
      const dismissed = await send('POST', '/houses/suggestions/dismiss', {
        uploadIds: [second],
      });
      expect(dismissed.status).toBe(204);
      const again = await send('POST', '/houses/suggestions/approve', {
        uploadIds: [second],
        propertyId: house.id,
        accept: ['gasSupplier'],
      });
      expect(again.status).toBe(422);
    });

    it('suggests the companies documents name, to confirm, merge or dismiss', async () => {
      const edil = `Edil${run}`;
      const invoice = await upload(
        ['INVOICE'],
        {
          issuer: `${edil.toUpperCase()} SNC DI ROSSI MARIO E C.`,
          issue_date: '2025-12-16',
          total_amount: 55000,
        },
        'Invoice',
      );
      await upload(['INVOICE'], { issuer: `${edil} s.n.c.` }, 'Transfer');
      await upload(['RECEIPT'], { issuer: `Misread ${run}` }, 'Receipt');
      const misread = await upload(
        ['RECEIPT'],
        { issuer: `Banca ${run} S.p.A.` },
        'Receipt',
      );

      const orgs = await json<OrganizationDto[]>(
        await send('GET', '/organizations'),
      );
      const mine = orgs.filter((o) => o.name.toLowerCase().includes(run));
      // Printed three ways, one company: the legal form and what follows it do not count.
      const company = mine.find((o) => o.name.startsWith(edil.toUpperCase()));
      expect(company).toMatchObject({ status: 'PENDING', documentCount: 2 });
      expect(mine.filter((o) => /edil/i.test(o.name))).toHaveLength(1);

      let entities = await json<EntityRefDto[]>(await send('GET', '/entities'));
      expect(entities.find((e) => e.id === company?.id)).toMatchObject({
        kind: 'organization',
        status: 'pending',
      });

      expect(
        (await send('POST', `/organizations/${company?.id}/confirm`)).status,
      ).toBe(204);
      entities = await json<EntityRefDto[]>(await send('GET', '/entities'));
      expect(entities.find((e) => e.id === company?.id)?.status).toBe(
        'confirmed',
      );

      // "Banca <run>" is really the same company: merged, its name stays as an alias.
      const bank = mine.find((o) => o.name.startsWith('Banca'));
      const merged = await json<OrganizationDetailDto>(
        await send('POST', `/organizations/${company?.id}/merge`, {
          from: bank?.id,
        }),
      );
      expect(merged.aliases).toContain(`Banca ${run} S.p.A.`);
      expect(merged.documents.map((d) => d.uploadId)).toEqual(
        expect.arrayContaining([invoice, misread]),
      );
      // Newest first; the invoice keeps the date and total it prints.
      expect(merged.documents.at(-1)).toMatchObject({
        uploadId: invoice,
        date: '2025-12-16',
        amount: 55000,
      });

      // A misread name, dismissed, is never suggested again.
      const wrong = mine.find((o) => o.name.startsWith('Misread'));
      expect(
        (await send('POST', `/organizations/${wrong?.id}/dismiss`)).status,
      ).toBe(204);
      await upload(['RECEIPT'], { issuer: `MISREAD ${run}` }, 'Receipt');
      const after = await json<OrganizationDto[]>(
        await send('GET', '/organizations'),
      );
      expect(
        after.filter((o) => o.name.toLowerCase().includes(`misread ${run}`)),
      ).toEqual([expect.objectContaining({ status: 'DISMISSED' })]);
      expect(after.some((o) => o.id === bank?.id)).toBe(false);
      entities = await json<EntityRefDto[]>(await send('GET', '/entities'));
      expect(entities.some((e) => e.id === wrong?.id)).toBe(false);
    });

    it('lists houses as entities, found by address and street', async () => {
      const house = await createProperty(`Casa E${run}`, {
        address: `Via E${run} 9`,
        city: 'Ronco all’Adige',
      });
      const entities = await json<EntityRefDto[]>(
        await send('GET', '/entities'),
      );
      expect(entities.find((e) => e.id === house.id)).toMatchObject({
        kind: 'house',
        status: 'confirmed',
        aliases: expect.arrayContaining([`Via E${run} 9`, `Via E${run}`]),
      });
    });

    it('keeps a 3D model per house in its own bucket', async () => {
      const house = await createProperty(`Casa M${run}`);
      const glb = Buffer.concat([
        Buffer.from('glTF', 'latin1'),
        Buffer.alloc(16, 1),
      ]);
      const uploaded = await fetch(
        `${base}/properties/${house.id}/model?filename=house.glb`,
        {
          method: 'PUT',
          headers: { 'content-type': 'application/octet-stream' },
          body: glb,
        },
      );
      const withModel = await json<PropertyDto>(uploaded);
      expect(withModel.model).toMatchObject({
        filename: 'house.glb',
        format: 'GLB',
        sizeBytes: glb.length,
      });
      const file = await fetch(`${base}/properties/${house.id}/model`);
      expect(file.headers.get('content-type')).toBe('model/gltf-binary');
      expect(Buffer.from(await file.arrayBuffer()).equals(glb)).toBe(true);

      const wrong = await fetch(
        `${base}/properties/${house.id}/model?filename=house.obj`,
        { method: 'PUT', body: 'not a model' },
      );
      expect(wrong.status).toBe(400);

      const removed = await json<PropertyDto>(
        await send('DELETE', `/properties/${house.id}/model`),
      );
      expect(removed.model).toBeNull();
    });
  },
);
