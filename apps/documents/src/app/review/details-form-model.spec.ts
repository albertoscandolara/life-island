import {
  cleanDetails,
  emptyValue,
  inputKind,
  parseInput,
  removeAt,
  setAt,
  type JsonSchema,
} from './details-form-model';

const receipt: JsonSchema = {
  type: 'object',
  properties: {
    merchant: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        vatNumber: { type: 'string' },
      },
      required: ['name'],
    },
    purchasedAt: {
      type: 'string',
      description:
        'Purchase date and time, ISO 8601 (e.g. 2026-10-23T18:42:00Z)',
    },
    total: { type: 'number' },
    paymentMethod: { type: 'string', enum: ['cash', 'card', 'other'] },
    items: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          rawName: { type: 'string' },
          lineTotal: { type: 'number' },
        },
        required: ['rawName', 'lineTotal'],
      },
    },
  },
  required: ['merchant', 'purchasedAt', 'total', 'items'],
};

describe('details form model', () => {
  it('picks an input for each kind of value', () => {
    const p = receipt.properties!;
    expect(inputKind(p['total'])).toBe('number');
    expect(inputKind(p['paymentMethod'])).toBe('select');
    expect(inputKind(p['purchasedAt'])).toBe('datetime');
    expect(
      inputKind({ type: 'string', description: 'Expense date, YYYY-MM-DD' }),
    ).toBe('date');
    expect(inputKind({ type: 'boolean' })).toBe('boolean');
  });

  it('starts an empty value with the required keys', () => {
    expect(emptyValue(receipt)).toEqual({
      merchant: { name: '' },
      purchasedAt: '',
      total: null,
      items: [],
    });
  });

  it('sets and removes values by path, creating what is missing', () => {
    let value = setAt({}, ['merchant', 'name'], 'Coop');
    value = setAt(value, ['items', 0, 'rawName'], 'PANE');
    value = setAt(value, ['items', 1, 'rawName'], 'LATTE');
    expect(value).toEqual({
      merchant: { name: 'Coop' },
      items: [{ rawName: 'PANE' }, { rawName: 'LATTE' }],
    });
    expect(removeAt(value, ['items', 0])).toEqual({
      merchant: { name: 'Coop' },
      items: [{ rawName: 'LATTE' }],
    });
    expect(setAt(value, ['merchant', 'name'], undefined)).toEqual({
      merchant: {},
      items: [{ rawName: 'PANE' }, { rawName: 'LATTE' }],
    });
  });

  it('reads numbers with a comma, keeps what is not a number for the server to explain', () => {
    expect(parseInput('3,69', { type: 'number' })).toBe(3.69);
    expect(parseInput('abc', { type: 'number' })).toBe('abc');
    expect(parseInput('', { type: 'string' })).toBeUndefined();
    expect(parseInput('true', { type: 'boolean' })).toBe(true);
  });

  it('drops empty optional values but keeps required ones', () => {
    expect(
      cleanDetails(
        {
          merchant: { name: 'Coop', vatNumber: '' },
          purchasedAt: '',
          total: 3.69,
          paymentMethod: '',
          items: [{ rawName: 'PANE', lineTotal: 3.69 }],
        },
        receipt,
      ),
    ).toEqual({
      merchant: { name: 'Coop' },
      purchasedAt: '',
      total: 3.69,
      items: [{ rawName: 'PANE', lineTotal: 3.69 }],
    });
  });
});
