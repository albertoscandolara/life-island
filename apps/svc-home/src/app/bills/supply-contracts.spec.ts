import {
  assignBySupplyContract,
  isPdr,
  isPod,
  readBillCodes,
  supplierKey,
  supplyContracts,
  type ContractBill,
} from './supply-contracts.js';

const bill = (overrides: Partial<ContractBill>): ContractBill => ({
  utility: 'GAS',
  provider: 'Magis Energia S.p.A.',
  customerCode: '1161254900',
  supplyPointCode: null,
  offer: null,
  propertyId: null,
  assignment: null,
  manual: false,
  periodStart: null,
  periodEnd: null,
  issueDate: null,
  ...overrides,
});

describe('supply codes', () => {
  it('tells a POD and a PDR from a customer code by their shape', () => {
    expect(isPod('IT001E36435004')).toBe(true);
    expect(isPod('it001e 3643 5004')).toBe(true);
    expect(isPdr('01680102015791')).toBe(true);
    expect(isPod('1000007483')).toBe(false);
    expect(isPdr('1161254900')).toBe(false);
  });

  it('splits the one customer_id field older bills were read into', () => {
    expect(readBillCodes({ customer_id: 'IT001E36435004' })).toEqual({
      supplyPoint: 'IT001E36435004',
      customerCode: null,
      offer: null,
    });
    expect(readBillCodes({ customer_id: '1000007483' })).toEqual({
      supplyPoint: null,
      customerCode: '1000007483',
      offer: null,
    });
    expect(
      readBillCodes({
        customer_code: '1161254900',
        pdr: '0168 0102 0157 91',
        offer_name: 'Magis Gas Fix',
      }),
    ).toEqual({
      supplyPoint: '01680102015791',
      customerCode: '1161254900',
      offer: 'Magis Gas Fix',
    });
  });

  it('ignores legal forms in a supplier name', () => {
    expect(supplierKey('Magis Energia S.p.A.')).toBe('magis energia');
    expect(supplierKey('MAGIS ENERGIA SPA')).toBe('magis energia');
    expect(supplierKey('Lene S.r.l.')).toBe('lene');
  });
});

describe('assignBySupplyContract', () => {
  it('puts a bill with no house where the other bills of its contract are', () => {
    const [a, b] = assignBySupplyContract([
      bill({ propertyId: 'p2', assignment: 'ADDRESS' }),
      bill({ provider: 'MAGIS ENERGIA SPA' }),
    ]);
    expect(a.assignment).toBe('ADDRESS');
    expect(b).toMatchObject({
      propertyId: 'p2',
      assignment: 'SUPPLY_CONTRACT',
    });
  });

  it('does not move a bill you took off every house, nor guess between houses', () => {
    const bills = assignBySupplyContract([
      bill({ propertyId: 'p1' }),
      bill({ propertyId: 'p2' }),
      bill({}),
      bill({ customerCode: '42', manual: true }),
      bill({ customerCode: '42', propertyId: 'p1' }),
    ]);
    expect(bills[2].propertyId).toBeNull();
    expect(bills[3].propertyId).toBeNull();
  });

  it('never links electricity and gas through the same code', () => {
    const [, gas] = assignBySupplyContract([
      bill({ utility: 'ELECTRICITY', propertyId: 'p2' }),
      bill({}),
    ]);
    expect(gas.propertyId).toBeNull();
  });
});

describe('supplyContracts', () => {
  it('keeps one code through an offer change and replaces it on a new supplier', () => {
    const contracts = supplyContracts([
      bill({
        propertyId: 'p2',
        periodStart: '2025-01-01',
        periodEnd: '2025-02-28',
        offer: 'Gas Fix',
      }),
      bill({
        propertyId: 'p2',
        periodStart: '2025-03-01',
        periodEnd: '2025-04-30',
        offer: 'Gas Flex',
      }),
      bill({
        provider: 'Other Gas S.r.l.',
        customerCode: '555123',
        propertyId: 'p2',
        periodStart: '2025-05-01',
        periodEnd: '2025-06-30',
      }),
      bill({
        utility: 'ELECTRICITY',
        provider: 'Lene S.r.l.',
        customerCode: '1000007483',
        supplyPointCode: 'IT001E36435004',
        propertyId: 'p2',
        periodStart: '2025-01-01',
        periodEnd: '2025-01-31',
      }),
      bill({ customerCode: null, propertyId: 'p2' }),
    ]);
    expect(contracts).toHaveLength(3);
    const magis = contracts.find((c) => c.customerCode === '1161254900')!;
    expect(magis).toMatchObject({
      status: 'REPLACED',
      from: '2025-01-01',
      to: '2025-04-30',
      billCount: 2,
      offers: [
        { name: 'Gas Fix', from: '2025-01-01', to: '2025-02-28' },
        { name: 'Gas Flex', from: '2025-03-01', to: '2025-04-30' },
      ],
    });
    expect(contracts.find((c) => c.customerCode === '555123')?.status).toBe(
      'ACTIVE',
    );
    // Electricity has its own contract and code, active beside the gas one.
    expect(contracts.find((c) => c.utility === 'ELECTRICITY')).toMatchObject({
      status: 'ACTIVE',
      supplyPointCode: 'IT001E36435004',
    });
  });
});
