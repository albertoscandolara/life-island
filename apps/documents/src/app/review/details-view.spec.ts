import { humanize, toFields } from './details-view';

describe('humanize', () => {
  it('turns keys into labels', () => {
    expect(humanize('purchasedAt')).toBe('Purchased at');
    expect(humanize('frame730')).toBe('Frame730');
    expect(humanize('vat_number')).toBe('Vat number');
  });
});

describe('toFields', () => {
  const schema = {
    properties: {
      merchant: { properties: { name: {}, address: {} } },
      total: {},
      items: { items: { properties: { rawName: {}, lineTotal: {} } } },
      paid: {},
    },
  };

  it('orders fields by the schema and renders each kind', () => {
    const fields = toFields(
      {
        paid: true,
        items: [{ lineTotal: 2.5, rawName: 'MILK' }, { rawName: 'BREAD' }],
        total: 2.5,
        merchant: { address: 'Via Roma 1', name: 'Coop' },
        tags: ['a', 'b'],
      },
      schema,
    );
    expect(fields.map((field) => field.label)).toEqual([
      'Merchant',
      'Total',
      'Items',
      'Paid',
      'Tags',
    ]);
    expect(fields[0].fields?.map((field) => field.label)).toEqual([
      'Name',
      'Address',
    ]);
    expect(fields[1]).toEqual({ label: 'Total', kind: 'value', value: '2.50' });
    expect(fields[2]).toMatchObject({
      kind: 'table',
      headers: ['Raw name', 'Line total'],
      rows: [
        ['MILK', '2.50'],
        ['BREAD', '–'],
      ],
    });
    expect(fields[3].value).toBe('Yes');
    expect(fields[4]).toEqual({ label: 'Tags', kind: 'list', value: 'a, b' });
  });

  it('keeps the stored order without a schema', () => {
    expect(
      toFields({ b: 1, a: null }).map((field) => [field.label, field.value]),
    ).toEqual([
      ['B', '1'],
      ['A', '–'],
    ]);
  });
});
