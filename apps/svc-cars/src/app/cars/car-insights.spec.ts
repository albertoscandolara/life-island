import {
  buildSeries,
  costsOf,
  coverList,
  readCarDocument,
  renewalsOf,
  type ApprovedCarDocument,
} from './car-documents.js';
import { carFines, fineRenewals } from './car-fines.js';
import { insuranceHistory } from './car-insurance.js';
import {
  speedIndexOf,
  tyreAgeYears,
  tyreRenewals,
  tyreSetOf,
} from './car-tyres.js';
import { carUsage, odometerReadings } from './car-usage.js';
import { checkQuoteFiles, fileBlock } from './quote-advisor.js';
import { quoteDossier } from './quote-dossier.js';
import type { TyreSetRow } from '../db/schema.js';

function approved(
  uploadId: string,
  type: ApprovedCarDocument['type'],
  fields: Record<string, string | number | boolean | null>,
  markedStatus: ApprovedCarDocument['markedStatus'] = null,
) {
  return {
    uploadId,
    title: uploadId,
    type,
    groupKey: null,
    reading: readCarDocument(type, fields, [uploadId]),
    uploadedAt: '2026-01-01T00:00:00.000Z',
    markedStatus,
  };
}

const fuel = (
  id: string,
  date: string,
  km: number | null,
  litres: number,
  amount: number,
) =>
  approved(id, 'VEHICLE_EXPENSE', {
    expense_kind: 'fuel',
    expense_date: date,
    odometer_km: km,
    litres,
    total_amount: amount,
  });

const today = '2026-11-10';

describe('km and fuel', () => {
  it('flags a reading lower than an earlier one and leaves it out of the pace', () => {
    const docs = [
      approved('r1', 'VEHICLE_INSPECTION', {
        inspection_date: '2024-11-10',
        outcome: 'passed',
        odometer_km: 40000,
      }),
      approved('s1', 'VEHICLE_EXPENSE', {
        expense_kind: 'scheduled_service',
        expense_date: '2025-06-01',
        odometer_km: 30000,
        total_amount: 200,
      }),
      approved('r2', 'VEHICLE_INSPECTION', {
        inspection_date: '2026-11-10',
        outcome: 'passed',
        odometer_km: 60000,
      }),
    ];
    const readings = odometerReadings(docs);
    expect(readings.map((r) => [r.uploadId, r.anomaly])).toEqual([
      ['r1', false],
      ['s1', true],
      ['r2', false],
    ]);
    const { usage } = carUsage(docs, costsOf(docs), {}, today);
    expect(usage.kmPerYear).toBe(10000);
    expect(usage.estimatedKm).toBe(60000);
  });

  it('works out the consumption, the price per litre and the cost per km', () => {
    const docs = [
      fuel('f1', '2026-09-01', 50000, 40, 70),
      fuel('f2', '2026-09-20', 50600, 36, 63),
      fuel('f3', '2026-10-10', 51200, 42, 72),
      fuel('f4', '2026-10-20', null, 10, 18),
    ];
    const { usage } = carUsage(
      docs,
      costsOf(docs),
      { 'emissions.combinedFuelConsumptionL100km': 5.5 },
      today,
    );
    expect(usage.fills.map((f) => f.litresPer100Km)).toEqual([
      null,
      7,
      6,
      null,
    ]);
    // (36 + 42) litres over 1.200 km.
    expect(usage.litresPer100Km).toBe(6.5);
    expect(usage.officialLitresPer100Km).toBe(5.5);
    expect(usage.pricePerLitre).toBe(1.742);
    expect(usage.fuelCostPerKm).toBe(0.113);
    expect(usage.costLast12Months).toBe(223);
    // 1.200 km in 39 days: about 11.231 km a year.
    expect(usage.kmPerYear).toBe(11231);
    expect(usage.costPerKm).toBe(0.02);
  });

  it('dates a service due only by km from the pace, and says when it is passed', () => {
    const service = approved('svc', 'VEHICLE_EXPENSE', {
      expense_kind: 'scheduled_service',
      expense_date: '2026-01-10',
      odometer_km: 40000,
      next_service_km: 60000,
      total_amount: 300,
    });
    const docs = [
      service,
      approved('rev', 'VEHICLE_INSPECTION', {
        inspection_date: '2026-11-10',
        outcome: 'passed',
        odometer_km: 50000,
      }),
    ];
    const { trend } = carUsage(docs, costsOf(docs), {}, today);
    const renewal = renewalsOf(
      {},
      buildSeries(docs, today),
      [service],
      today,
      trend,
    ).find((r) => r.kind === 'service');
    expect(renewal).toMatchObject({
      level: 'ok',
      dueOdometerKm: 60000,
      dueDate: '2027-09-10',
    });
    expect(renewal?.basis).toContain('Estimated');

    // No pace: the km alone, never dropped.
    const alone = renewalsOf({}, [], [service], today).find(
      (r) => r.kind === 'service',
    );
    expect(alone).toMatchObject({
      level: 'ok',
      dueDate: null,
      dueOdometerKm: 60000,
    });
    const passed = renewalsOf({}, [], [service], today, {
      kmPerYear: null,
      last: { date: today, km: 61000 },
      estimatedKm: 61000,
    }).find((r) => r.kind === 'service');
    expect(passed?.level).toBe('expired');
  });

  it('keeps the printed service date when it comes before the km', () => {
    const service = approved('svc', 'VEHICLE_EXPENSE', {
      expense_kind: 'scheduled_service',
      expense_date: '2026-01-10',
      next_service_date: '2027-01-10',
      next_service_km: 200000,
      total_amount: 300,
    });
    const renewal = renewalsOf({}, [], [service], today, {
      kmPerYear: 10000,
      last: { date: today, km: 50000 },
      estimatedKm: 50000,
    }).find((r) => r.kind === 'service');
    expect(renewal).toMatchObject({ dueDate: '2027-01-10', level: 'ok' });
  });
});

describe('insurance history', () => {
  const policy = (
    id: string,
    from: string,
    insurer: string,
    cu: number,
    amount: number,
    coverages: string,
  ) =>
    approved(id, 'CAR_INSURANCE', {
      policy_number: `P-${id}`,
      insurer,
      start_date: from,
      end_date: `${Number(from.slice(0, 4)) + 1}${from.slice(4)}`,
      cu_class: cu,
      coverages,
      total_amount: amount,
    });

  it('sets each policy against the one before and notes a worse class and a rise', () => {
    const docs = [
      policy(
        'a',
        '2024-03-01',
        'Allianz',
        2,
        400,
        'RCA, Furto e incendio, Cristalli',
      ),
      policy(
        'b',
        '2025-03-01',
        'Allianz',
        4,
        520,
        'RCA; Furto e incendio; Assistenza stradale',
      ),
    ];
    const history = insuranceHistory(buildSeries(docs, today), costsOf(docs));
    expect(history.periods.map((p) => p.uploadId)).toEqual(['b', 'a']);
    expect(history.periods[0]).toMatchObject({
      premium: 520,
      premiumChange: 0.3,
      cuClass: 4,
      cuClassChange: 2,
      added: ['Assistenza stradale'],
      removed: ['Cristalli'],
    });
    expect(history.periods[1].premiumChange).toBeNull();
    const notes = history.notes.map((n) => [n.tone, n.text.slice(0, 30)]);
    expect(notes).toEqual([
      ['warning', 'The bonus-malus class got wors'],
      ['warning', 'The premium went up 30% (€ 400'],
      ['warning', 'No longer covered: Cristalli.'],
      ['info', 'New covers: Assistenza stradal'],
    ]);
  });

  it('notes a better class, a lower premium and a new insurer', () => {
    const docs = [
      policy('a', '2024-03-01', 'Allianz', 5, 500, 'RCA'),
      policy('b', '2025-03-01', 'Prima', 4, 450, 'RCA'),
    ];
    const tones = insuranceHistory(
      buildSeries(docs, today),
      costsOf(docs),
    ).notes;
    expect(tones.map((n) => n.tone)).toEqual(['success', 'success', 'info']);
    expect(tones[2].text).toBe('You moved from Allianz to Prima.');
  });

  it('splits the covers as listed', () => {
    expect(coverList('RCA, Furto e incendio; Cristalli\nKasko.')).toEqual([
      'RCA',
      'Furto e incendio',
      'Cristalli',
      'Kasko',
    ]);
    expect(coverList('')).toBeNull();
  });
});

describe('fines', () => {
  const fine = (fields: Record<string, string | number | null> = {}) =>
    approved('f1', 'VEHICLE_EXPENSE', {
      expense_kind: 'fine',
      expense_date: '2026-10-20',
      supplier: 'Polizia Locale di Milano',
      violation_date: '2026-10-20',
      violation_article: 'art. 142 c. 8',
      total_amount: 173,
      ...fields,
    });

  it('runs every deadline from the notification', () => {
    const { fines, points } = carFines(
      [fine({ notification_date: '2026-11-07', licence_points: 3 })],
      new Map(),
      today,
    );
    expect(fines[0]).toMatchObject({
      stage: 'discount',
      reducedAmount: 121.1,
      discountUntil: '2026-11-12',
      payBy: '2027-01-06',
      judgeAppealBy: '2026-12-07',
      prefectAppealBy: '2027-01-06',
      driverBy: '2027-01-06',
      points: 3,
    });
    expect(points).toEqual([
      {
        driverName: 'Driver not named',
        driverPersonId: null,
        points: 3,
        fines: 1,
      },
    ]);
    const [renewal] = fineRenewals(fines, today);
    expect(renewal).toMatchObject({
      kind: 'fine',
      subject: 'Fine of 20 Oct 2026',
      level: 'expiring',
      dueDate: '2026-11-12',
      daysLeft: 2,
    });
    expect(renewal.basis).toContain('Name the driver');
  });

  it('takes what you add by hand over what was read', () => {
    const { fines, points } = carFines(
      [fine({ notification_date: '2026-08-01' })],
      new Map([
        [
          'f1',
          {
            notifiedOn: '2026-10-01',
            paidOn: null,
            points: 5,
            driverPersonId: null,
            driverName: 'Mario Rossi',
          },
        ],
      ]),
      today,
    );
    expect(fines[0]).toMatchObject({
      notifiedOn: '2026-10-01',
      stage: 'due',
      driverBy: null,
    });
    expect(points[0]).toMatchObject({ driverName: 'Mario Rossi', points: 5 });
  });

  it('asks for the notification, goes late after 60 days, and stops once paid', () => {
    expect(
      fineRenewals(carFines([fine()], new Map(), today).fines, today)[0],
    ).toMatchObject({
      level: 'missing',
    });
    const late = carFines(
      [fine({ notification_date: '2026-08-01' })],
      new Map(),
      today,
    );
    expect(late.fines[0].stage).toBe('late');
    expect(fineRenewals(late.fines, today)[0].level).toBe('expired');
    const paid = carFines(
      [fine({ notification_date: '2026-11-07', payment_date: '2026-11-08' })],
      new Map(),
      today,
    );
    expect(paid.fines[0].stage).toBe('paid');
    expect(fineRenewals(paid.fines, today)).toEqual([]);
  });
});

describe('tyres', () => {
  const row = (change: Partial<TyreSetRow>): TyreSetRow => ({
    id: 't1',
    vehicleId: 'v1',
    season: 'summer',
    label: null,
    size: '205/55 R16 91V',
    dot: '2321',
    purchasedOn: null,
    treadMm: 5,
    mounted: true,
    storedAt: null,
    notes: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...change,
  });

  it('reads the speed index and the age from the sidewall', () => {
    expect(speedIndexOf('205/55 R16 91V')).toBe('V');
    expect(speedIndexOf('195/65R15 91 T')).toBe('T');
    expect(speedIndexOf(null)).toBeNull();
    expect(tyreAgeYears('2321', '2026-11-10')).toBe(5.4);
    expect(tyreAgeYears('9921', today)).toBeNull();
  });

  it('checks tread, age and the speed index against the card', () => {
    const old = tyreSetOf(
      row({ dot: '0115', treadMm: 1.2, size: '205/55 R16 91T' }),
      200,
      today,
    );
    expect(old.checks.map((c) => c.tone)).toEqual([
      'danger',
      'danger',
      'danger',
    ]);
    const winter = tyreSetOf(
      row({
        season: 'winter',
        treadMm: 3.5,
        size: '205/55 R16 91Q',
        dot: '2321',
      }),
      190,
      today,
    );
    expect(winter.checks.map((c) => [c.tone, c.text.slice(0, 12)])).toEqual([
      ['warning', 'Tread 3,5 mm'],
      ['ok', 'Speed index '],
    ]);
  });

  it('warns for summer tyres in the winter period, and winter ones after 15 May', () => {
    const summer = tyreRenewals([tyreSetOf(row({}), 190, today)], 190, today);
    expect(summer[0]).toMatchObject({
      level: 'expiring',
      dueDate: '2026-11-15',
    });
    const december = tyreRenewals(
      [tyreSetOf(row({}), 190, '2026-12-01')],
      190,
      '2026-12-01',
    );
    expect(december[0]).toMatchObject({
      level: 'expired',
      dueDate: '2026-11-15',
    });
    const july = tyreRenewals(
      [tyreSetOf(row({}), 190, '2026-07-01')],
      190,
      '2026-07-01',
    );
    expect(july[0]).toMatchObject({ level: 'ok', dueDate: '2026-11-15' });

    const winterRow = row({ season: 'winter', size: '205/55 R16 91Q' });
    const june = tyreRenewals(
      [tyreSetOf(winterRow, 190, '2026-06-01')],
      190,
      '2026-06-01',
    );
    expect(june[0]).toMatchObject({ level: 'expired', dueDate: '2026-05-15' });
    const april = tyreRenewals(
      [tyreSetOf(winterRow, 190, '2026-04-20')],
      190,
      '2026-04-20',
    );
    expect(april[0]).toMatchObject({
      level: 'expiring',
      dueDate: '2026-05-15',
    });
    const fast = row({ season: 'winter', size: '205/55 R16 91V' });
    expect(
      tyreRenewals([tyreSetOf(fast, 190, '2026-06-01')], 190, '2026-06-01')[0],
    ).toMatchObject({
      level: 'ok',
      dueDate: null,
    });
  });

  it('asks which set is on the car, and says nothing without tyres', () => {
    expect(tyreRenewals([], 190, today)).toEqual([]);
    expect(
      tyreRenewals(
        [tyreSetOf(row({ mounted: false }), 190, today)],
        190,
        today,
      )[0],
    ).toMatchObject({ level: 'missing' });
  });
});

describe('insurance quotes', () => {
  it('sends PDFs as documents and photos as images, and refuses anything else', () => {
    const data = Buffer.from('x');
    expect(
      fileBlock({ name: 'a.pdf', contentType: 'application/pdf', data })?.type,
    ).toBe('document');
    expect(
      fileBlock({ name: 'a.jpg', contentType: 'image/jpeg', data })?.type,
    ).toBe('image');
    expect(
      fileBlock({ name: 'a.txt', contentType: 'text/plain', data }),
    ).toBeNull();
    expect(() => checkQuoteFiles([])).toThrow('at least one');
    expect(() =>
      checkQuoteFiles([{ name: 'a.txt', contentType: 'text/plain', data }]),
    ).toThrow('PDF');
    expect(() =>
      checkQuoteFiles(
        Array.from({ length: 5 }, () => ({
          name: 'q.pdf',
          contentType: 'application/pdf',
          data,
        })),
      ),
    ).toThrow('at most 4');
  });

  it('tells the model the car and its policies, never the VIN or tax code', () => {
    const dossier = quoteDossier(
      {
        values: {
          make: 'FIAT',
          commercialName: 'PANDA',
          registrationNumber: 'AB123CD',
          vin: 'ZFA31200000123456',
          'parties.holder.taxCode': 'SCNLRT92A01L781X',
          'engine.maxNetPowerKw': 51,
          'engine.fuelKey': 'petrol',
          firstRegistrationDate: '2019-03-14',
        },
        usage: { kmPerYear: 9000, estimatedKm: 60000 },
        insurance: {
          periods: [
            {
              insurer: 'Allianz',
              number: 'P1',
              validFrom: '2025-03-01',
              validUntil: '2026-03-01',
              premium: 520,
              cuClass: 4,
              cuClassChange: 2,
              coverages: ['RCA'],
              cancelled: false,
            },
          ],
        },
      } as never,
      'My daughter drives it too',
    );
    expect(dossier).toContain('Car: FIAT PANDA, plate AB123CD');
    expect(dossier).toContain('Power: 51 kW');
    expect(dossier).toContain('Allianz, policy P1: 2025-03-01 to 2026-03-01');
    expect(dossier).toContain('CU class got worse');
    expect(dossier).toContain('My note: My daughter drives it too');
    expect(dossier).not.toContain('ZFA31200000123456');
    expect(dossier).not.toContain('SCNLRT92A01L781X');
  });
});
