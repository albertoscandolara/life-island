import {
  buildSeries,
  carDocumentType,
  costsOf,
  costTotals,
  endOfMonthAfter,
  isOutdated,
  matchVehicle,
  nextInspectionDue,
  normalizeCode,
  numberOf,
  proposeVehicleChanges,
  readCarDocument,
  renewalsOf,
  roadTaxDeadline,
  roleOf,
  type ApprovedCarDocument,
} from './car-documents.js';

const parentOf = new Map<string, string | null>([
  ['CAR_DOCUMENT', null],
  ['VEHICLE_REGISTRATION', 'CAR_DOCUMENT'],
  ['CAR_INSURANCE', 'CAR_DOCUMENT'],
  ['ROAD_TAX', 'CAR_DOCUMENT'],
  ['VEHICLE_INSPECTION', 'CAR_DOCUMENT'],
  ['VEHICLE_EXPENSE', 'CAR_DOCUMENT'],
  ['FUEL_RECEIPT', 'VEHICLE_EXPENSE'],
  ['PASSPORT', 'ID_DOCUMENT'],
]);

const libretto = {
  registration_number: 'ab 123 cd',
  first_registration_date: '2019-03-14',
  holder_name: 'SCANDOLARA ALBERTO',
  make: 'FIAT',
  type_variant_version: '312 PXA1A 02',
  commercial_name: 'PANDA',
  vin: 'ZFA31200000123456',
  engine_capacity_cc: '1.242',
  max_net_power_kw: '51',
  fuel: 'PETROL',
  co2_g_km: '119,5',
  seat_count: 5,
  category: 'M1',
  document_number: 'CC0000000X',
  issue_date: '2019-03-14',
};

function approved(
  uploadId: string,
  type: ApprovedCarDocument['type'],
  fields: Record<string, string | number | boolean | null>,
  markedStatus: ApprovedCarDocument['markedStatus'] = null,
  title = uploadId,
  groupKey: string | null = null,
) {
  return {
    uploadId,
    title,
    type,
    groupKey,
    reading: readCarDocument(type, fields, [title]),
    uploadedAt: '2026-01-01T00:00:00.000Z',
    markedStatus,
  };
}

describe('car documents', () => {
  it('knows a car document and its type through the category tree', () => {
    expect(carDocumentType(['FUEL_RECEIPT'], parentOf)).toEqual({
      isCar: true,
      type: 'VEHICLE_EXPENSE',
    });
    expect(carDocumentType(['CAR_DOCUMENT'], parentOf)).toEqual({
      isCar: true,
      type: null,
    });
    expect(carDocumentType(['PASSPORT'], parentOf).isCar).toBe(false);
  });

  it('reads the card under the model names, with numbers as printed in Italy', () => {
    expect(numberOf('1.242')).toBe(1242);
    expect(numberOf('5,2')).toBe(5.2);
    expect(numberOf('€ 1.234,50')).toBe(1234.5);
    const reading = readCarDocument('VEHICLE_REGISTRATION', libretto);
    expect(reading.registrationNumber).toBe('AB123CD');
    expect(reading.values).toMatchObject({
      'engine.capacityCc': 1242,
      'engine.fuelKey': 'petrol',
      'emissions.co2GKm': 119.5,
      categoryCode: 'M1',
      seatCount: 5,
    });
    expect(reading.number).toBe('CC0000000X');
    expect(reading.validFrom).toBe('2019-03-14');
  });

  it('reads only the car reference from other documents', () => {
    const reading = readCarDocument('CAR_INSURANCE', {
      registration_number: 'AB123CD',
      engine_capacity_cc: 999,
      end_date: '2027-03-14',
      total_amount: 328.5,
    });
    expect(reading.values).toEqual({ registrationNumber: 'AB123CD' });
    expect(reading.validUntil).toBe('2027-03-14');
    expect(reading.amount).toBe(328.5);
  });

  it('matches by VIN, else by plate, and never across two VINs', () => {
    const cars = [
      { id: 'a', values: { registrationNumber: 'AB123CD', vin: 'VIN1' } },
      { id: 'b', values: { registrationNumber: 'ZZ999ZZ' } },
    ];
    expect(
      matchVehicle({ registrationNumber: 'X', vin: 'vin1' }, cars),
    ).toEqual({
      vehicle: cars[0],
      match: 'vin',
    });
    expect(
      matchVehicle({ registrationNumber: 'zz 999 zz', vin: null }, cars).match,
    ).toBe('registration_number');
    expect(
      matchVehicle({ registrationNumber: 'AB123CD', vin: 'VIN2' }, cars).match,
    ).toBe('none');
    expect(
      matchVehicle({ registrationNumber: null, vin: null }, cars).match,
    ).toBe('none');
    expect(normalizeCode(' ab-123 cd ')).toBe('AB123CD');
  });

  it('proposes new and different values with the code and a suggestion', () => {
    const printed = readCarDocument('VEHICLE_REGISTRATION', {
      ...libretto,
      fuel: 'petrol_lpg',
      make: 'LANCIA',
    }).values;
    const changes = proposeVehicleChanges(
      printed,
      {
        registrationNumber: 'AB123CD',
        make: 'FIAT',
        'engine.fuelKey': 'petrol',
        'engine.capacityCc': 1242,
      },
      false,
    );
    const of = (field: string) => changes.find((c) => c.field === field);
    expect(of('make')).toMatchObject({
      code: 'D.1',
      kind: 'different_value',
      suggestion: 'check',
    });
    expect(of('engine.fuelKey')).toMatchObject({
      code: 'P.3',
      suggestion: 'accept',
    });
    expect(of('vin')).toMatchObject({
      code: 'E',
      kind: 'new_value',
      suggestion: 'accept',
    });
    expect(of('engine.capacityCc')).toBeUndefined();
    expect(of('registrationNumber')).toBeUndefined();
    const old = proposeVehicleChanges(
      printed,
      { 'engine.fuelKey': 'diesel' },
      true,
    );
    expect(old.find((c) => c.field === 'engine.fuelKey')?.suggestion).toBe(
      'keep_current',
    );
  });

  it('works out the road tax and revisione deadlines', () => {
    expect(endOfMonthAfter('2019-03-14', 48)).toBe('2023-03-31');
    expect(roadTaxDeadline('2027-02')).toBe('2027-03-31');
    expect(roadTaxDeadline('2026-12')).toBe('2027-01-31');
    expect(roadTaxDeadline('bad')).toBeNull();
    expect(nextInspectionDue('2025-03-07', 'passed', null)).toBe('2027-03-31');
    expect(nextInspectionDue('2025-03-07', 'repeat', null)).toBe('2025-04-07');
    expect(nextInspectionDue('2025-03-07', 'suspended', null)).toBe(
      '2025-03-07',
    );
    expect(nextInspectionDue('2025-03-07', 'passed', '2027-02-28')).toBe(
      '2027-02-28',
    );
  });

  it('numbers versions per type, newest first, and leaves expenses out', () => {
    const docs = [
      approved('i1', 'CAR_INSURANCE', {
        start_date: '2025-03-14',
        end_date: '2026-03-14',
      }),
      approved('i2', 'CAR_INSURANCE', {
        start_date: '2026-03-14',
        end_date: '2026-10-01',
      }),
      approved('e1', 'VEHICLE_EXPENSE', {
        expense_date: '2026-05-01',
        total_amount: 50,
      }),
    ];
    const series = buildSeries(docs, '2026-11-08');
    expect(series).toHaveLength(1);
    expect(
      series[0].versions.map((v) => [v.document.uploadId, v.version, v.status]),
    ).toEqual([
      ['i2', 2, 'expired'],
      ['i1', 1, 'superseded'],
    ]);
  });

  it('warns for every renewable item, with the 15 days of insurance cover', () => {
    const today = '2026-11-08';
    const docs = [
      approved('ins', 'CAR_INSURANCE', {
        start_date: '2025-11-01',
        end_date: '2026-11-01',
      }),
      approved('tax', 'ROAD_TAX', {
        expiry_month: '2026-10',
        validity_months: 12,
      }),
      approved('rev', 'VEHICLE_INSPECTION', {
        inspection_date: '2024-12-02',
        outcome: 'passed',
      }),
      approved('svc', 'VEHICLE_EXPENSE', {
        expense_kind: 'scheduled_service',
        expense_date: '2026-01-10',
        next_service_date: '2027-06-01',
        next_service_km: 90000,
        total_amount: 240,
      }),
    ];
    const series = buildSeries(docs, today);
    const renewals = renewalsOf(
      { firstRegistrationDate: '2019-03-14' },
      series,
      docs.filter((d) => d.type === 'VEHICLE_EXPENSE'),
      today,
    );
    const of = (kind: string) => renewals.find((r) => r.kind === kind);
    expect(of('insurance')).toMatchObject({
      level: 'grace',
      dueDate: '2026-11-01',
      daysLeft: -7,
      graceUntil: '2026-11-16',
    });
    expect(of('road_tax')).toMatchObject({
      level: 'expiring',
      dueDate: '2026-11-30',
      daysLeft: 22,
    });
    expect(of('inspection')).toMatchObject({
      level: 'expiring',
      dueDate: '2026-12-31',
      daysLeft: 53,
    });
    expect(of('service')).toMatchObject({ level: 'ok', dueOdometerKm: 90000 });
    expect(
      renewalsOf({}, buildSeries([], today), [], today).map((r) => [
        r.kind,
        r.level,
      ]),
    ).toEqual([
      ['insurance', 'missing'],
      ['road_tax', 'missing'],
    ]);
  });

  it('expires insurance after the grace period, and knows the first revisione', () => {
    const today = '2026-11-20';
    const series = buildSeries(
      [approved('ins', 'CAR_INSURANCE', { end_date: '2026-11-01' })],
      today,
    );
    expect(renewalsOf({}, series, [], today)[0]).toMatchObject({
      level: 'expired',
      daysLeft: -19,
    });
    const young = renewalsOf(
      { firstRegistrationDate: '2024-06-10' },
      series,
      [],
      today,
    );
    expect(young.find((r) => r.kind === 'inspection')).toMatchObject({
      level: 'ok',
      dueDate: '2028-06-30',
    });
    const old = renewalsOf(
      { firstRegistrationDate: '2015-06-10' },
      series,
      [],
      today,
    );
    expect(old.find((r) => r.kind === 'inspection')?.level).toBe('missing');
  });

  it('never warns for an exempt road tax or a cancelled policy', () => {
    const today = '2026-11-08';
    const docs = [
      approved('tax', 'ROAD_TAX', { expiry_month: '2025-01', exempt: true }),
      approved('ins', 'CAR_INSURANCE', { end_date: '2026-11-10' }, 'cancelled'),
    ];
    const renewals = renewalsOf({}, buildSeries(docs, today), [], today);
    expect(renewals.find((r) => r.kind === 'road_tax')).toMatchObject({
      level: 'ok',
      basis: 'Exempt',
    });
    expect(renewals.find((r) => r.kind === 'insurance')?.level).toBe('missing');
  });

  it('adds up the costs per year and kind', () => {
    const docs = [
      approved('ins', 'CAR_INSURANCE', {
        payment_date: '2026-03-10',
        total_amount: 328.5,
      }),
      approved('f1', 'VEHICLE_EXPENSE', {
        expense_kind: 'fuel',
        expense_date: '2026-10-02',
        total_amount: 52.4,
        litres: 29.94,
      }),
      approved('f2', 'VEHICLE_EXPENSE', {
        expense_kind: 'fuel',
        expense_date: '2026-10-20',
        total_amount: 47.6,
      }),
      approved('f3', 'VEHICLE_EXPENSE', {
        expense_kind: 'fuel',
        expense_date: '2025-12-20',
        total_amount: 40,
      }),
      approved('reg', 'VEHICLE_REGISTRATION', libretto),
    ];
    const costs = costsOf(docs);
    expect(costs.map((c) => c.uploadId)).toEqual(['f2', 'f1', 'ins', 'f3']);
    expect(costs[1]).toMatchObject({ kind: 'fuel', litres: 29.94 });
    expect(costTotals(costs)).toEqual([
      { year: 2026, kind: 'insurance', total: 328.5 },
      { year: 2026, kind: 'fuel', total: 100 },
      { year: 2025, kind: 'fuel', total: 40 },
    ]);
  });

  it('calls a registration certificate outdated when a newer one is on file', () => {
    const newer = approved('new', 'VEHICLE_REGISTRATION', {
      ...libretto,
      issue_date: '2024-01-01',
    });
    expect(
      isOutdated(readCarDocument('VEHICLE_REGISTRATION', libretto), [newer]),
    ).toBe(true);
    expect(
      isOutdated(newer.reading, [
        approved('old', 'VEHICLE_REGISTRATION', libretto),
      ]),
    ).toBe(false);
  });

  describe('one insurance sent as policy, certificate and receipt', () => {
    const common = {
      registration_number: 'EJ560PZ',
      insurer: 'Allianz Direct S.p.A.',
      start_date: '2026-04-10',
      end_date: '2027-04-10',
    };
    const policy = approved(
      'pol',
      'CAR_INSURANCE',
      {
        ...common,
        policy_number: 'DI303516658-001',
        cu_class: 1,
        total_amount: 272.76,
        payment_date: '2026-03-29',
      },
      null,
      'Polizza_DI303516658-001.pdf',
    );
    const certificate = approved(
      'cert',
      'CAR_INSURANCE',
      { ...common, policy_number: 'DI303516658-001', end_date: '2027-04-09' },
      null,
      'Certificato_di_Assicurazione-anche_internazionale_DI303516658-001.pdf',
    );
    const receipt = approved(
      'rec',
      'CAR_INSURANCE',
      {
        ...common,
        policy_number: 'DI 303516658-001',
        total_amount: 272.76,
        payment_date: '2026-03-29',
      },
      null,
      'Ricevuta_DI303516658-001.pdf',
    );
    const older = approved('old', 'CAR_INSURANCE', {
      policy_number: 'XYZ1',
      start_date: '2025-04-10',
      end_date: '2026-04-10',
      total_amount: 300,
      payment_date: '2025-04-01',
    });

    it('tells the documents apart by what was read, else by their name', () => {
      expect(roleOf('certificate', 'Ricevuta.pdf')).toBe('certificate');
      expect(roleOf(null, 'Ricevuta_DI303516658-001.pdf')).toBe('receipt');
      expect(roleOf(null, 'Quietanza premio')).toBe('receipt');
      expect(roleOf(null, 'Carta verde')).toBe('certificate');
      expect(roleOf(null, 'Polizza auto')).toBe('policy');
      expect(roleOf(null, 'scan_001.pdf')).toBeNull();
    });

    it('makes one version of the three, with the policy as main document', () => {
      const series = buildSeries(
        [receipt, older, certificate, policy],
        '2026-11-09',
      );
      expect(series).toHaveLength(1);
      const [current, previous] = series[0].versions;
      expect(current.version).toBe(2);
      expect(current.status).toBe('current');
      expect(current.document.uploadId).toBe('pol');
      expect(current.document.members.map((m) => m.uploadId)).toEqual([
        'pol',
        'cert',
        'rec',
      ]);
      expect(current.document.reading).toMatchObject({
        number: 'DI303516658-001',
        validFrom: '2026-04-10',
        validUntil: '2027-04-10',
        amount: 272.76,
      });
      expect(previous).toMatchObject({ version: 1, status: 'superseded' });
    });

    it('takes what the main document lacks from the others', () => {
      const [version] = buildSeries([certificate, receipt], '2026-11-09')[0]
        .versions;
      expect(version.document.uploadId).toBe('cert');
      expect(version.document.reading.amount).toBe(272.76);
    });

    it('counts the premium once, and each instalment receipt of a split one', () => {
      expect(costsOf([policy, certificate, receipt])).toEqual([
        expect.objectContaining({
          uploadId: 'rec',
          amount: 272.76,
          date: '2026-03-29',
        }),
      ]);
      const second = approved(
        'rec2',
        'CAR_INSURANCE',
        {
          policy_number: 'DI303516658-001',
          total_amount: 136.38,
          payment_date: '2026-10-10',
        },
        null,
        'Ricevuta rata 2',
      );
      expect(costsOf([policy, receipt, second]).map((c) => c.uploadId)).toEqual(
        ['rec2', 'rec'],
      );
      expect(costsOf([policy, certificate])).toHaveLength(1);
    });

    it('keeps documents you put together or apart by hand', () => {
      const unread = approved(
        'scan',
        'CAR_INSURANCE',
        { total_amount: 272.76 },
        null,
        'scan.pdf',
        'number:DI303516658001',
      );
      const detached = { ...certificate, groupKey: 'own:cert' };
      const versions = buildSeries(
        [policy, detached, receipt, unread],
        '2026-11-09',
      )[0].versions;
      expect(versions).toHaveLength(2);
      const record = versions.find((v) => v.document.uploadId === 'pol');
      expect(record?.document.members.map((m) => m.uploadId)).toEqual([
        'pol',
        'scan',
        'rec',
      ]);
    });

    it('cancels the whole record when one of its documents is', () => {
      const today = '2026-11-09';
      const series = buildSeries(
        [policy, { ...receipt, markedStatus: 'cancelled' as const }],
        today,
      );
      expect(series[0].versions[0].status).toBe('cancelled');
      expect(
        costsOf([policy, { ...receipt, markedStatus: 'cancelled' as const }]),
      ).toEqual([]);
      expect(
        renewalsOf({}, series, [], today).find((r) => r.kind === 'insurance')
          ?.level,
      ).toBe('missing');
    });
  });
});
