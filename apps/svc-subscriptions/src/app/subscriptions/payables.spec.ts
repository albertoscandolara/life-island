import { suggestMatches } from '@life-island/contracts';
import {
  chargeDays,
  chargeOfPayable,
  chargePayableKey,
  chargePayables,
  costOn,
  lastCharge,
  type ChargedContract,
} from './payables.js';

const ID = '4d1c2b3a-1111-4222-8333-944455556666';

const netflix = (over: Partial<ChargedContract> = {}): ChargedContract => ({
  id: ID,
  name: 'Netflix',
  provider: 'Netflix International',
  cost: 13.99,
  cycle: 'monthly',
  startOn: '2025-01-03',
  renewsOn: '2025-01-03',
  autoRenew: true,
  autoPay: true,
  status: 'active',
  priceChanges: [],
  changedOn: '2026-01-01',
  ...over,
});

describe('subscription charges as payables', () => {
  it('keys a charge by contract and day, and reads it back', () => {
    const key = chargePayableKey(ID, '2026-11-03');
    expect(key).toBe(`subscriptions:charge:${ID}.2026-11-03`);
    expect(chargeOfPayable(key)).toEqual({
      contractId: ID,
      date: '2026-11-03',
    });
    expect(chargeOfPayable('home:bill:1')).toBeNull();
    expect(chargeOfPayable(`subscriptions:charge:${ID}`)).toBeNull();
  });

  it('charges every cycle from the renewal day, the 31st at month end', () => {
    expect(chargeDays(netflix(), '2026-09-01', '2026-11-30')).toEqual([
      '2026-09-03',
      '2026-10-03',
      '2026-11-03',
    ]);
    // Counted from a renewal day in the future too.
    expect(
      chargeDays(
        netflix({ renewsOn: '2027-01-31', startOn: null, cycle: 'bimonthly' }),
        '2026-08-01',
        '2026-12-31',
      ),
    ).toEqual(['2026-09-30', '2026-11-30']);
    expect(
      chargeDays(
        netflix({ renewsOn: '2025-03-15', cycle: 'yearly' }),
        '2026-01-01',
        '2026-12-31',
      ),
    ).toEqual(['2026-03-15']);
  });

  it('never charges before the start, during a trial, after the end or the cancellation', () => {
    expect(
      chargeDays(
        netflix({ startOn: '2026-10-10' }),
        '2026-09-01',
        '2026-11-30',
      ),
    ).toEqual(['2026-11-03']);
    expect(
      chargeDays(
        netflix({
          status: 'trial',
          startOn: '2026-10-03',
          renewsOn: '2026-11-03',
        }),
        '2026-09-01',
        '2026-12-31',
      ),
    ).toEqual(['2026-11-03', '2026-12-03']);
    expect(
      chargeDays(
        netflix({ autoRenew: false, renewsOn: '2026-11-03', startOn: null }),
        '2026-09-01',
        '2026-12-31',
      ),
    ).toEqual(['2026-09-03', '2026-10-03']);
    expect(
      chargeDays(
        netflix({ status: 'cancelled', changedOn: '2026-10-20' }),
        '2026-09-01',
        '2026-12-31',
      ),
    ).toEqual(['2026-09-03', '2026-10-03']);
    expect(
      chargeDays(netflix({ cost: 0 }), '2026-09-01', '2026-12-31'),
    ).toEqual([]);
    expect(
      chargeDays(
        netflix({ renewsOn: null, startOn: null }),
        '2026-09-01',
        '2026-12-31',
      ),
    ).toEqual([]);
  });

  it('prices each charge at the cost of its day', () => {
    const history = netflix({
      cost: 15.99,
      priceChanges: [
        { date: '2026-06-10', from: 12.99, to: 13.99 },
        { date: '2026-10-20', from: 13.99, to: 15.99 },
      ],
    });
    expect(costOn(history, '2026-05-03')).toBe(12.99);
    expect(costOn(history, '2026-06-10')).toBe(13.99);
    expect(costOn(history, '2026-10-03')).toBe(13.99);
    expect(costOn(history, '2026-11-03')).toBe(15.99);
  });

  it('lists the charges whose window touches the days asked', () => {
    const [charge] = chargePayables([netflix()], {
      from: '2026-11-12',
      to: '2026-11-13',
    });
    expect(charge).toEqual({
      key: chargePayableKey(ID, '2026-11-03'),
      module: 'subscriptions',
      kind: 'charge',
      title: 'Netflix, charge of 2026-11-03',
      payees: ['Netflix International', 'Netflix'],
      amount: 13.99,
      direction: 'out',
      date: '2026-11-03',
      window: { from: '2026-10-29', to: '2026-11-13' },
      tolerance: 0.1,
      autoPay: true,
      path: '/subscriptions',
    });
    expect(
      chargePayables([netflix()], { from: '2026-11-14', to: '2026-11-25' }),
    ).toEqual([]);
  });

  it('matches its own charge for sure, and a price rise only as "check it"', () => {
    const payables = chargePayables([netflix()], {
      from: '2026-11-01',
      to: '2026-11-30',
    });
    const move = (amount: number) => ({
      id: 'm1',
      date: '2026-11-04',
      amount,
      description: 'NETFLIX.COM AMSTERDAM',
    });
    expect(suggestMatches([move(-13.99)], payables, [])[0]).toMatchObject({
      confidence: 'sure',
      payableKeys: [chargePayableKey(ID, '2026-11-03')],
    });
    expect(suggestMatches([move(-14.99)], payables, [])[0]).toMatchObject({
      confidence: 'check',
      amounts: [14.99],
    });
    expect(suggestMatches([move(-17.99)], payables, [])).toEqual([]);
  });

  it('shows the last matched charge, and how much over its price it was', () => {
    const paid = (date: string, amount: number, unlinked = false) => ({
      payableKey: chargePayableKey(ID, date),
      amount,
      paidOn: date,
      accountName: 'Conto',
      unlinkedAt: unlinked ? new Date() : null,
    });
    const contract = { id: ID, cost: 13.99, priceChanges: [] };
    expect(lastCharge(contract, [])).toBeNull();
    expect(
      lastCharge(contract, [
        paid('2026-10-03', 13.99),
        paid('2026-11-03', 14.99),
        paid('2026-12-03', 13.99, true),
        { ...paid('2026-12-03', 9), payableKey: 'home:bill:x' },
      ]),
    ).toEqual({
      date: '2026-11-03',
      paid: 14.99,
      expected: 13.99,
      paidOn: '2026-11-03',
      accounts: ['Conto'],
      priceRise: 1,
    });
    expect(
      lastCharge(contract, [paid('2026-10-03', 13.99)])?.priceRise,
    ).toBeNull();
  });
});
