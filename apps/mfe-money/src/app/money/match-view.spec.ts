import type {
  AccountDto,
  MatchesDto,
  MatchMovementDto,
  MatchPayableDto,
} from '@life-island/contracts';
import {
  candidates,
  cashAccount,
  cashItems,
  leftOf,
  openItems,
  pickAmount,
} from './match-view';

const payable = (over: Partial<MatchPayableDto> = {}): MatchPayableDto => ({
  key: 'home:bill:1',
  module: 'home',
  kind: 'bill',
  title: 'Enel, electricity bill',
  payees: ['Enel'],
  amount: 100,
  direction: 'out',
  date: '2026-11-10',
  window: { from: '2026-11-01', to: '2026-12-25' },
  path: '/home/bills',
  areaName: 'Houses',
  emblem: '🏡',
  linked: 0,
  ...over,
});

const move = (over: Partial<MatchMovementDto> = {}): MatchMovementDto => ({
  id: 'm1',
  date: '2026-11-10',
  amount: -100,
  description: 'BONIFICO',
  accountName: 'Current',
  linked: 0,
  ...over,
});

const matches = (over: Partial<MatchesDto> = {}): MatchesDto => ({
  from: '2026-07-21',
  to: '2026-11-18',
  suggestions: [],
  movements: [],
  payables: [],
  links: [],
  sources: [],
  ...over,
});

describe('the "To match" tab', () => {
  it('lists what is left to pay, not what is proposed or paid', () => {
    const open = openItems(
      matches({
        payables: [
          payable({ key: 'home:bill:late', date: '2026-11-20' }),
          payable({ key: 'home:bill:paid', linked: 100 }),
          payable({ key: 'home:bill:proposed' }),
          payable({ key: 'home:bill:half', linked: 40 }),
        ],
        suggestions: [
          {
            movementId: 'm1',
            payableKeys: ['home:bill:proposed'],
            amounts: [100],
            confidence: 'sure',
            score: 1,
            reasons: [],
          },
        ],
      }),
    );
    expect(open.map((p) => p.key)).toEqual([
      'home:bill:half',
      'home:bill:late',
    ]);
  });

  it('offers the movements that could have paid an item, closest first', () => {
    const list = candidates(
      matches({
        movements: [
          move({ id: 'far', amount: -100, date: '2026-12-20' }),
          move({ id: 'near', amount: -100, date: '2026-11-11' }),
          move({ id: 'odd', amount: -30 }),
          move({ id: 'in', amount: 100 }),
          move({ id: 'outside', date: '2026-10-31' }),
          move({ id: 'spent', linked: 100 }),
        ],
      }),
      payable(),
    );
    expect(list.map((m) => m.id)).toEqual(['near', 'far', 'odd']);
  });

  it('links as much as both sides have left', () => {
    expect(pickAmount(payable({ linked: 40 }), move({ amount: -100 }))).toBe(
      60,
    );
    expect(pickAmount(payable(), move({ amount: -30 }))).toBe(30);
    expect(leftOf(-84.37, 84.37)).toBe(0);
  });

  it('links a price rise whole, within the tolerance only', () => {
    const sub = payable({ amount: 12.99, tolerance: 0.1 });
    expect(pickAmount(sub, move({ amount: -13.99 }))).toBe(13.99);
    expect(pickAmount(sub, move({ amount: -20 }))).toBe(12.99);
    expect(
      pickAmount(payable({ amount: 12.99 }), move({ amount: -13.99 })),
    ).toBe(12.99);
  });

  it('keeps receipts paid in cash apart, until they are added', () => {
    const cash = payable({
      key: 'groceries:receipt:1',
      paidInCash: true,
      date: '2026-11-12',
    });
    const added = payable({
      key: 'groceries:receipt:2',
      paidInCash: true,
      linked: 100,
    });
    const data = matches({ payables: [payable(), cash, added] });
    expect(openItems(data).map((p) => p.key)).toEqual(['home:bill:1']);
    expect(cashItems(data).map((p) => p.key)).toEqual(['groceries:receipt:1']);
  });

  it('adds cash to a cash account, else to any open one', () => {
    const accounts = [
      { id: 'bank', kind: 'current', archived: false },
      { id: 'old', kind: 'cash', archived: true },
      { id: 'wallet', kind: 'cash', archived: false },
    ] as AccountDto[];
    expect(cashAccount(accounts)).toBe('wallet');
    expect(cashAccount(accounts.slice(0, 2))).toBe('bank');
    expect(cashAccount([])).toBeNull();
  });
});
