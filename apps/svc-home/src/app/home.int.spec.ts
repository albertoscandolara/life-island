import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import {
  createServiceDb,
  paymentEventHandler,
  processOnce,
  type ServiceDb,
} from '@life-island/be-common';
import type {
  BillDto,
  DeadlineDto,
  EntityRefDto,
  EventEnvelope,
  HouseServicesDto,
  HouseSuggestionDto,
  HouseTaxExpensesDto,
  KnownCompanyDto,
  OrganizationDetailDto,
  PayableDto,
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
          'delete from home.house_document_overrides where upload_id = any($1)',
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
          "delete from home.supply_points where code ilike '%' || $1 || '%' or code like '%' || $2 || '%'",
          [run, runDigits],
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

    /** A Money matching event, as svc-money's outbox would send it. */
    async function deliverPayment(type: string, payload: unknown) {
      const event: EventEnvelope = {
        id: randomUUID(),
        type,
        source: 'svc-money',
        occurredAt: new Date().toISOString(),
        payload,
      };
      await processOnce(svc.pool, 'home', event.id, (client) =>
        paymentEventHandler('home', 'home')(event, client),
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
        payment_method: 'Domiciliazione bancaria',
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

      // January prints a direct debit: February, printing nothing, inherits it.
      expect(point.contracts[0]).toMatchObject({
        autoPay: null,
        directDebit: true,
        autoPaid: true,
      });
      expect(ours.map((bill) => bill.autoPaid)).toEqual([true, true]);
      // Your choice on the contract wins for every bill of it.
      expect(
        (
          await send('PATCH', `/supply-contracts/${a.contractId}`, {
            autoPay: false,
          })
        ).status,
      ).toBe(200);
      const paidByMe = await json<BillDto[]>(await send('GET', '/bills'));
      expect(
        paidByMe
          .filter((bill) => bill.contractId === a.contractId)
          .map((bill) => bill.autoPaid),
      ).toEqual([false, false]);
      await send('PATCH', `/supply-contracts/${a.contractId}`, {
        autoPay: null,
      });

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
        'gasPoint',
      ]);

      const house = await json<PropertyDto>(
        await send('POST', '/houses/suggestions/approve', {
          uploadIds: [first],
          propertyId: null,
          accept: ['address', 'city', 'gasSupplier', 'gasPoint'],
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
        supplyPoints: {
          ELECTRICITY: null,
          GAS: `0168${runDigits}01`,
          WATER: null,
        },
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

    it('reads a company the same however it is printed, and lets you edit it', async () => {
      const name = `Arcoda${run}`;
      await upload(['PAYSLIP'], { employer: `${name.toUpperCase()} S.R.L.` });
      await upload(['PAYSLIP'], { employer: name.toLowerCase() });
      await upload(['PAYSLIP'], { issuer: `${name} srl` }, 'CU');
      // A typo in a long name is the same company: kept as one of its names.
      const typo = `${name.slice(0, 3)}k${name.slice(4)} S.r.l.`;
      await upload(['PAYSLIP'], { issuer: typo }, 'Letter');

      let mine = (
        await json<OrganizationDto[]>(await send('GET', '/organizations'))
      ).filter(
        (o) => /^arc.da/i.test(o.name) && o.name.toLowerCase().includes(run),
      );
      expect(mine).toHaveLength(1);
      // Its payslips name it as your employer.
      expect(mine[0]).toMatchObject({
        documentCount: 4,
        status: 'PENDING',
        roles: ['EMPLOYER'],
      });
      expect(mine[0].aliases).toContain(typo);

      const edited = await json<OrganizationDto>(
        await send('PATCH', `/organizations/${mine[0].id}`, {
          name: `Arcoda ${run} (employer)`,
          vatNumber: 'IT 01234567890',
          roles: ['OTHER'],
        }),
      );
      expect(edited).toMatchObject({
        vatNumber: '01234567890',
        roles: ['OTHER'],
        documentCount: 4,
      });
      // The old name stays as one of its names, so its documents still find it.
      expect(edited.aliases).toContain(mine[0].name);

      // A copy made before (another spelling) merges into it on the next sync.
      await svc.pool.query(
        `insert into home.organizations (name, name_key, status) values ($1, $2, 'PENDING')`,
        [`ARCODA ${run} spa`, `arcoda ${run}`],
      );
      await upload(['PAYSLIP'], { employer: name }, 'Payslip');
      mine = (
        await json<OrganizationDto[]>(await send('GET', '/organizations'))
      ).filter(
        (o) => /^arc.da/i.test(o.name) && o.name.toLowerCase().includes(run),
      );
      expect(mine.map((o) => o.id)).toEqual([edited.id]);
      // A new payslip says it again: it is your employer.
      expect(mine[0].roles).toEqual(['OTHER', 'EMPLOYER']);
    });

    it('deletes an empty company, and flags twins with different codes', async () => {
      const twin = `Twin${run} S.r.l.`;
      await svc.pool.query(
        `insert into home.organizations (name, name_key, status, tax_code) values ($1, $2, 'CONFIRMED', $3), ($1, $2, 'CONFIRMED', $4)`,
        [twin, `twin${run}`, `1${runDigits}01`, `2${runDigits}02`],
      );
      let twins = (
        await json<OrganizationDto[]>(await send('GET', '/organizations'))
      ).filter((o) => o.name === twin);
      expect(twins).toHaveLength(2);
      // The same name: shown as maybe the same company, though the codes differ.
      expect(twins[0].possibleDuplicates.map((d) => d.id)).toEqual([
        twins[1].id,
      ]);
      expect(
        (await send('DELETE', `/organizations/${twins[1].id}`)).status,
      ).toBe(204);
      twins = (
        await json<OrganizationDto[]>(await send('GET', '/organizations'))
      ).filter((o) => o.name === twin);
      expect(twins.map((o) => o.id)).toEqual([twins[0].id]);
      await send('DELETE', `/organizations/${twins[0].id}`);

      // One that issued documents is merged, never deleted.
      await upload(['INVOICE'], { issuer: `Busy${run}` }, 'Invoice');
      const busy = (
        await json<OrganizationDto[]>(await send('GET', '/organizations'))
      ).find((o) => o.name === `Busy${run}`);
      expect((await send('DELETE', `/organizations/${busy?.id}`)).status).toBe(
        409,
      );
    });

    it('keeps a merged twin merged, though its bills print another code', async () => {
      const name = `Lene M${run} S.r.l.`;
      const [kept, other] = [`3${runDigits}03`, `4${runDigits}04`];
      // The company you have (its logo, its code), and a bill of the same
      // company printing another code: a second "Lene", flagged as the same.
      await svc.pool.query(
        `insert into home.organizations (name, name_key, status, tax_code) values ($1, $2, 'CONFIRMED', $3)`,
        [name, `lene m${run}`, kept],
      );
      const bill = await upload(['ELECTRICITY_BILL'], {
        provider: name,
        supplier_tax_code: other,
        invoice_number: `L-${run}-1`,
        total_amount: 40,
      });
      const twins = async () =>
        (
          await json<OrganizationDto[]>(await send('GET', '/organizations'))
        ).filter((o) => o.name === name);
      const before = await twins();
      expect(before).toHaveLength(2);
      const mine = before.find((o) => o.taxCode === kept);
      const copy = before.find((o) => o.taxCode === other);
      expect(mine?.possibleDuplicates.map((d) => d.id)).toEqual([copy?.id]);

      // You merge the copy into yours: it stays one company, after the next
      // sync too, and the bills are yours.
      const merged = await json<OrganizationDetailDto>(
        await send('POST', `/organizations/${mine?.id}/merge`, {
          from: copy?.id,
        }),
      );
      expect(merged.id).toBe(mine?.id);
      await upload(['ELECTRICITY_BILL'], {
        provider: name,
        supplier_tax_code: other,
        invoice_number: `L-${run}-2`,
        total_amount: 41,
      });
      const after = await twins();
      expect(after.map((o) => o.id)).toEqual([mine?.id]);
      expect(after[0]).toMatchObject({ taxCode: kept, billCount: 2 });
      const bills = await json<BillDto[]>(await send('GET', '/bills'));
      expect(bills.find((b) => b.uploadId === bill)?.supplierId).toBe(mine?.id);
    });

    it('undoes a wrong merge: a name goes back to its own company', async () => {
      // Two companies you have, merged by mistake: the documents and bills of
      // the second now show under the first.
      const [road, abroad] = [`Strade ${run}`, `Esteri ${run}`];
      const code = `5${runDigits}05`;
      const passport = await upload(
        ['PASSPORT'],
        { issuer: abroad },
        'Passport',
      );
      const booklet = await upload(['INVOICE'], { issuer: road }, 'Booklet');
      const bill = await upload(['ELECTRICITY_BILL'], {
        provider: abroad,
        supplier_tax_code: code,
        invoice_number: `E-${run}-1`,
        total_amount: 30,
      });
      const find = async (name: string) =>
        (
          await json<OrganizationDto[]>(await send('GET', '/organizations'))
        ).find((o) => o.name === name);
      const [mit, maeci] = [await find(road), await find(abroad)];
      const merged = await json<OrganizationDetailDto>(
        await send('POST', `/organizations/${mit?.id}/merge`, {
          from: maeci?.id,
        }),
      );
      expect(merged.aliases).toContain(abroad);
      expect(merged.documents.map((d) => d.uploadId)).toContain(passport);

      // Its name is not this company: it gets its own again, with what it printed.
      const split = await json<OrganizationDetailDto>(
        await send('POST', `/organizations/${mit?.id}/split`, { name: abroad }),
      );
      expect(split).toMatchObject({
        name: abroad,
        status: 'CONFIRMED',
        taxCode: code,
        billCount: 1,
      });
      expect(split.documents.map((d) => d.uploadId)).toEqual(
        expect.arrayContaining([passport]),
      );
      const left = await json<OrganizationDetailDto>(
        await send('GET', `/organizations/${mit?.id}`),
      );
      expect(left.aliases).not.toContain(abroad);
      expect(left.billCount).toBe(0);
      expect(left.documents.map((d) => d.uploadId)).toEqual([booklet]);
      const bills = await json<BillDto[]>(await send('GET', '/bills'));
      expect(bills.find((b) => b.uploadId === bill)?.supplierId).toBe(split.id);

      // And it stays split on the next sync.
      await upload(['ELECTRICITY_BILL'], {
        provider: abroad,
        supplier_tax_code: code,
        invoice_number: `E-${run}-2`,
        total_amount: 31,
      });
      expect((await find(abroad))?.billCount).toBe(2);
      expect((await find(road))?.billCount).toBe(0);

      // The whole company merged the wrong way round comes apart the same way.
      await send('POST', `/organizations/${split.id}/merge`, { from: mit?.id });
      const back = await json<OrganizationDetailDto>(
        await send('POST', `/organizations/${split.id}/split`, { name: road }),
      );
      expect(back).toMatchObject({ name: road, status: 'CONFIRMED' });
      expect(back.documents.map((d) => d.uploadId)).toEqual([booklet]);
      const abroadNow = await json<OrganizationDetailDto>(
        await send('GET', `/organizations/${split.id}`),
      );
      expect(abroadNow.aliases).not.toContain(road);
      expect(abroadNow.documents.map((d) => d.uploadId)).toContain(passport);

      // Only a name it is also printed as can go.
      expect(
        (
          await send('POST', `/organizations/${back.id}/split`, {
            name: road,
          })
        ).status,
      ).toBe(400);
    });

    it('knows a bank by its name or by its statements', async () => {
      await upload(['INVOICE'], { issuer: `Banca Q${run} S.p.A.` }, 'Fees');
      await upload(['ESTRATTO_CONTO'], { issuer: `Widi${run}` }, 'Statement');
      await upload(['INVOICE'], { issuer: `Shop${run}` }, 'Invoice');
      const all = await json<OrganizationDto[]>(
        await send('GET', '/organizations'),
      );
      const roles = (name: string) =>
        all.find((o) => o.name.toLowerCase().includes(name.toLowerCase()))
          ?.roles;
      expect(roles(`Banca Q${run}`)).toEqual(['BANK']);
      expect(roles(`Widi${run}`)).toEqual(['BANK']);
      expect(roles(`Shop${run}`)).toEqual([]);
      await upload(['CAR_INSURANCE'], { issuer: `Polizze${run}` }, 'Policy');
      const after = await json<OrganizationDto[]>(
        await send('GET', '/organizations'),
      );
      expect(after.find((o) => o.name === `Polizze${run}`)?.roles).toEqual([
        'INSURANCE',
      ]);
      await upload(
        ['PASSPORT'],
        { issuer: `Ministero Affari Esteri ${run}` },
        'Passport',
      );
      const bodies = await json<OrganizationDto[]>(
        await send('GET', '/organizations'),
      );
      expect(
        bodies.find((o) => o.name === `Ministero Affari Esteri ${run}`)?.roles,
      ).toEqual(['PUBLIC_BODY']);
      await upload(
        ['INVOICE'],
        { issuer: `Notaio Prova${run} Avv. Giuseppe` },
        'Deed',
      );
      const notaries = await json<OrganizationDto[]>(
        await send('GET', '/organizations'),
      );
      expect(
        notaries.find((o) => o.name === `Notaio Prova${run} Avv. Giuseppe`)
          ?.roles,
      ).toEqual(['PROFESSIONAL']);
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

    it('keeps one supply point per utility, and asks nothing for a new bill of it', async () => {
      const street = `Via Unica${run}`;
      const house = await createProperty(`${street} 3`, {
        address: `${street} 3`,
        postalCode: '37039',
        city: 'Tregnago',
        province: 'VR',
        electricitySupplier: 'Enel Energia',
        gasSupplier: 'Hera Comm',
        supplyPoints: {
          ELECTRICITY: `IT001E${run}`,
          GAS: `0169${runDigits}01`,
        },
      });
      expect(house.supplyPoints).toEqual({
        ELECTRICITY: `IT001E${run}`.toUpperCase(),
        GAS: `0169${runDigits}01`,
        WATER: null,
      });

      const at = `${street} 3, 37039 Tregnago (VR)`;
      const electricity = await upload(['ELECTRICITY_BILL'], {
        provider: 'ENEL ENERGIA S.P.A.',
        pod: `IT 001 E ${run}`,
        supply_address: at,
        billing_period: '2026-07-01/2026-08-31',
        total_amount: 80,
      });
      const gas = await upload(['GAS_BILL'], {
        provider: 'HERA COMM SPA',
        pdr: `0169${runDigits}01`,
        supply_address: at,
        billing_period: '2026-07-01/2026-08-31',
        total_amount: 40,
      });
      const suggestions = await json<HouseSuggestionDto[]>(
        await send('GET', '/houses/suggestions'),
      );
      expect(
        suggestions.filter((s) =>
          s.documents.some(
            (d) => d.uploadId === electricity || d.uploadId === gas,
          ),
        ),
      ).toEqual([]);

      // A new meter: only the electricity point changes, the gas one stays.
      const updated = await json<PropertyDto>(
        await send('PATCH', `/properties/${house.id}`, {
          supplyPoints: { ELECTRICITY: `IT002E${run}` },
        }),
      );
      expect(updated.supplyPoints.ELECTRICITY).toBe(
        `IT002E${run}`.toUpperCase(),
      );
      expect(updated.supplyPoints.GAS).toBe(`0169${runDigits}01`);
      expect(updated.supplyCodes).toContain(`IT001E${run}`.toUpperCase());
    });

    it('reads internet and insurance documents of a house', async () => {
      const street = `Via Rete${run}`;
      const house = await createProperty(`${street} 1`, {
        address: `${street} 1`,
      });
      const line = await upload(['INTERNET_BILL'], {
        provider: `Fibra${run}`,
        billing_period: '2026-09-01/2026-09-30',
        total_amount: 25,
        supply_address: `${street} 1, Verona`,
      });
      await upload(['HOME_INSURANCE'], {
        insurer: `Assicura${run}`,
        policy_number: `P${run}`,
        end_date: '2099-12-31',
        insured_address: `${street} 1, Verona`,
      });
      const services = await json<HouseServicesDto>(
        await send('GET', '/house-services'),
      );
      expect(
        services.internet.find((l) => l.provider === `Fibra${run}`),
      ).toMatchObject({ propertyId: house.id, status: 'ACTIVE' });
      expect(
        services.insurances.find((i) => i.insurer === `Assicura${run}`),
      ).toMatchObject({ propertyId: house.id, status: 'ACTIVE' });

      const moved = await json<HouseServicesDto>(
        await send('PATCH', `/house-services/documents/${line}`, {
          excluded: true,
        }),
      );
      expect(moved.internet.some((l) => l.provider === `Fibra${run}`)).toBe(
        false,
      );
    });

    it('says when the 730 cannot be reached', async () => {
      const expenses = await json<HouseTaxExpensesDto>(
        await send('GET', '/tax-expenses'),
      );
      expect(typeof expenses.available).toBe('boolean');
      if (!expenses.available) expect(expenses.expenses).toEqual([]);
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

    it('keeps a website, notes, a logo and a background per company', async () => {
      await upload(['PAYSLIP'], { employer: `Pixelia${run} srl` });
      const [company] = (
        await json<OrganizationDto[]>(await send('GET', '/organizations'))
      ).filter((o) => o.name.toLowerCase().includes(`pixelia${run}`));
      expect(company).toMatchObject({
        website: null,
        description: null,
        images: { logo: null, cover: null },
      });

      const edited = await json<OrganizationDto>(
        await send('PATCH', `/organizations/${company.id}`, {
          website: 'pixelia.example.it',
          description: 'Our web agency',
        }),
      );
      expect(edited).toMatchObject({
        website: 'https://pixelia.example.it',
        description: 'Our web agency',
      });
      expect(
        (
          await send('PATCH', `/organizations/${company.id}`, {
            website: 'javascript:alert(1)',
          })
        ).status,
      ).toBe(400);

      const png = Buffer.concat([
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        Buffer.alloc(16, 1),
      ]);
      const withLogo = await json<OrganizationDetailDto>(
        await fetch(`${base}/organizations/${company.id}/images/logo`, {
          method: 'PUT',
          headers: { 'content-type': 'application/octet-stream' },
          body: png,
        }),
      );
      expect(withLogo.images.logo).toEqual(expect.any(String));
      expect(withLogo.images.cover).toBeNull();
      const file = await fetch(
        `${base}/organizations/${company.id}/images/logo`,
      );
      expect(file.headers.get('content-type')).toBe('image/png');
      expect(file.headers.get('x-content-type-options')).toBe('nosniff');
      expect(Buffer.from(await file.arrayBuffer()).equals(png)).toBe(true);

      const svg = await fetch(
        `${base}/organizations/${company.id}/images/cover`,
        { method: 'PUT', body: '<svg xmlns="http://www.w3.org/2000/svg"/>' },
      );
      expect(svg.status).toBe(400);
      expect(
        (
          await fetch(`${base}/organizations/${company.id}/images/banner`, {
            method: 'PUT',
            body: png,
          })
        ).status,
      ).toBe(400);

      // A merged duplicate's logo moves to the company it is merged into.
      await svc.pool.query(
        `insert into home.organizations (name, name_key, status) values ($1, $2, 'CONFIRMED')`,
        [`Studio Q${run}`, `studio q${run}`],
      );
      const { rows } = await svc.pool.query<{ id: string }>(
        'select id from home.organizations where name = $1',
        [`Studio Q${run}`],
      );
      const merged = await json<OrganizationDetailDto>(
        await send('POST', `/organizations/${rows[0].id}/merge`, {
          from: company.id,
        }),
      );
      expect(merged).toMatchObject({
        website: 'https://pixelia.example.it',
        images: { logo: withLogo.images.logo },
      });

      const removed = await json<OrganizationDetailDto>(
        await send('DELETE', `/organizations/${merged.id}/images/logo`),
      );
      expect(removed.images.logo).toBeNull();
      expect(
        (await fetch(`${base}/organizations/${merged.id}/images/logo`)).status,
      ).toBe(404);
      await svc.pool.query('delete from home.organizations where id = $1', [
        merged.id,
      ]);
    });

    it('lists its bills for Money, and learns when a bank movement paid one', async () => {
      const bill = await upload(['ELECTRICITY_BILL'], {
        provider: `Luce ${run} Energia`,
        invoice_number: `F${run}`,
        issue_date: '2026-05-04',
        due_date: '2026-05-25',
        total_amount: '84,37',
      });
      const payables = await json<PayableDto[]>(
        await send('GET', '/payables?from=2026-05-01&to=2026-05-31'),
      );
      const key = `home:bill:${bill}`;
      expect(payables.find((p) => p.key === key)).toMatchObject({
        module: 'home',
        kind: 'bill',
        amount: 84.37,
        direction: 'out',
        date: '2026-05-25',
        window: { from: '2026-05-01', to: '2026-07-09' },
        path: '/home/bills',
      });
      expect(payables.find((p) => p.key === key)?.payees).toContain(
        `Luce ${run} Energia`,
      );
      expect(
        (await send('GET', '/payables?from=2026-07-10&to=2026-08-01')).ok,
      ).toBe(true);
      expect(
        (
          await json<PayableDto[]>(
            await send('GET', '/payables?from=2026-07-10&to=2026-08-01'),
          )
        ).some((p) => p.key === key),
      ).toBe(false);
      expect(
        (await send('GET', '/payables?from=2026-05-31&to=2026-05-01')).status,
      ).toBe(400);

      const linkId = randomUUID();
      const linked = {
        linkId,
        payableKey: key,
        module: 'home',
        movementId: randomUUID(),
        date: '2026-05-25',
        amount: 84.37,
        accountName: 'Conto corrente',
        description: `ADDEBITO SDD LUCE ${run.toUpperCase()} ENERGIA`,
        linkedAt: new Date().toISOString(),
      };
      await deliverPayment('money.payment_linked@1', linked);
      // Redelivered: still one payment.
      await deliverPayment('money.payment_linked@1', linked);
      const paid = await json<BillDto[]>(await send('GET', '/bills'));
      expect(paid.find((b) => b.uploadId === bill)?.bankPayment).toEqual({
        paid: 84.37,
        full: true,
        lastDate: '2026-05-25',
        accounts: ['Conto corrente'],
      });
      const deadlines = await json<DeadlineDto[]>(
        await send('GET', '/deadlines?from=2026-05-01&to=2026-05-31'),
      );
      expect(
        deadlines.find(
          (d) =>
            d.id.startsWith('bill:') &&
            d.date === '2026-05-25' &&
            d.title.includes(run),
        ),
      ).toMatchObject({ done: true });

      await deliverPayment('money.payment_unlinked@1', {
        linkId,
        payableKey: key,
        module: 'home',
        reason: 'undone',
        unlinkedAt: new Date().toISOString(),
      });
      const undone = await json<BillDto[]>(await send('GET', '/bills'));
      expect(undone.find((b) => b.uploadId === bill)?.bankPayment).toBeNull();

      // The undo of a link that had not arrived yet: the link stays undone.
      const early = randomUUID();
      await deliverPayment('money.payment_unlinked@1', {
        linkId: early,
        payableKey: key,
        module: 'home',
        reason: 'movement-removed',
        unlinkedAt: new Date().toISOString(),
      });
      await deliverPayment('money.payment_linked@1', {
        ...linked,
        linkId: early,
      });
      const still = await json<BillDto[]>(await send('GET', '/bills'));
      expect(still.find((b) => b.uploadId === bill)?.bankPayment).toBeNull();
      await svc.pool.query('delete from home.payments where payable_key = $1', [
        key,
      ]);
    });
  },
);
