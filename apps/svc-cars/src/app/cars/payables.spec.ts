import {
  suggestMatches,
  type CarCostDto,
  type CarFineDto,
} from '@life-island/contracts';
import {
  costPayableKey,
  costPayables,
  finePayableKey,
  finePayables,
  uploadIdOfPayable,
} from './payables.js';

const ID = '7a1c2b3a-1111-4222-8333-944455556666';
const query = { from: '2026-01-01', to: '2026-12-31' };

const cost = (over: Partial<CarCostDto> = {}): CarCostDto => ({
  uploadId: ID,
  title: 'Tagliando 60.000 km',
  type: 'VEHICLE_EXPENSE',
  kind: 'scheduled_service',
  date: '2026-10-12',
  amount: 389.5,
  supplier: 'Officina Rossi Srl',
  odometerKm: 60120,
  litres: null,
  bankPayment: null,
  ...over,
});

const fine = (over: Partial<CarFineDto> = {}): CarFineDto => ({
  uploadId: ID,
  title: 'Verbale',
  authority: 'Comune di Milano',
  number: 'V/2026/0412',
  article: 'art. 7',
  violationDate: '2026-09-02',
  notifiedOn: '2026-10-01',
  paidOn: null,
  amount: 100,
  reducedAmount: 70,
  points: null,
  driverPersonId: null,
  driverName: null,
  stage: 'due',
  discountUntil: '2026-10-06',
  payBy: '2026-11-30',
  judgeAppealBy: null,
  prefectAppealBy: null,
  driverBy: null,
  bankPayment: null,
  ...over,
});

describe('car costs and fines as payables', () => {
  it('keys costs and fines apart, and reads them back', () => {
    expect(costPayableKey(ID)).toBe(`cars:cost:${ID}`);
    expect(finePayableKey(ID)).toBe(`cars:fine:${ID}`);
    expect(uploadIdOfPayable(costPayableKey(ID))).toBe(ID);
    expect(uploadIdOfPayable(finePayableKey(ID))).toBe(ID);
    expect(uploadIdOfPayable('cars:cost:nope')).toBeNull();
    expect(uploadIdOfPayable(`home:bill:${ID}`)).toBeNull();
  });

  it('lists each priced cost with a day, never a fine twice', () => {
    expect(costPayables('Panda', [cost()], query)).toEqual([
      {
        key: costPayableKey(ID),
        module: 'cars',
        kind: 'cost',
        title: 'Panda: Tagliando 60.000 km',
        payees: ['Officina Rossi Srl'],
        amount: 389.5,
        direction: 'out',
        date: '2026-10-12',
        window: { from: '2026-10-02', to: '2026-11-26' },
        path: '/cars',
      },
    ]);
    expect(
      costPayables(
        'Panda',
        [cost({ kind: 'fine' }), cost({ date: null }), cost({ amount: 0 })],
        query,
      ),
    ).toEqual([]);
    expect(
      costPayables('Panda', [cost()], { from: '2026-12-01', to: '2026-12-31' }),
    ).toEqual([]);
  });

  it('proposes a fine at its reduced amount, up to the full one', () => {
    const [p] = finePayables('Panda', [fine()], query);
    expect(p).toMatchObject({
      key: finePayableKey(ID),
      kind: 'fine',
      title: 'Panda: fine no. V/2026/0412 of 2026-09-02',
      payees: ['Comune di Milano'],
      amount: 70,
      date: '2026-10-06',
      window: { from: '2026-09-02', to: '2027-01-29' },
    });
    expect(p.tolerance).toBeCloseTo(0.429, 3);
    expect(70 * (1 + p.tolerance!)).toBeGreaterThanOrEqual(100);

    const pay = (amount: number) =>
      suggestMatches(
        [
          {
            id: 'm1',
            date: '2026-10-03',
            amount: -amount,
            description: 'PAGOPA COMUNE DI MILANO VERBALE',
          },
        ],
        [p],
        [],
      )[0];
    expect(pay(70)).toMatchObject({ confidence: 'sure', amounts: [70] });
    // The full amount (after 5 days): a weaker match, linked whole.
    expect(pay(100)).toMatchObject({ confidence: 'check', amounts: [100] });
    expect(pay(140)).toBeUndefined();
  });

  it('waits for the notice when the fine has not reached you, and skips one with no amount', () => {
    const [p] = finePayables(
      'Panda',
      [fine({ notifiedOn: null, payBy: null, discountUntil: null })],
      query,
    );
    // 90 days of notice, 60 to pay, 60 more for a late payment.
    expect(p.window).toEqual({ from: '2026-09-02', to: '2027-03-31' });
    expect(p.date).toBe('2026-09-02');
    expect(finePayables('Panda', [fine({ amount: null })], query)).toEqual([]);
    expect(
      finePayables('Panda', [fine({ reducedAmount: null })], query)[0],
    ).toMatchObject({ amount: 100 });
    expect(
      finePayables('Panda', [fine({ reducedAmount: null })], query)[0]
        .tolerance,
    ).toBeUndefined();
  });
});
