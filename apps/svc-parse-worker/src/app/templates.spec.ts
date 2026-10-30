import type { CategoryDefinition } from './parsers/document-parser.js';
import {
  buildExtractedFields,
  buildExtractionPlan,
  mergeChunkResults,
  normalizeFieldValue,
  parseNumber,
  splitText,
  type RawFieldResult,
} from './templates.js';

const bill: CategoryDefinition = {
  id: 'BILL',
  title: 'Bill',
  description: '',
  template: {
    fields: [
      {
        key: 'provider',
        label: 'Provider',
        type: 'string',
        description: 'Who issued it',
        required: true,
      },
      {
        key: 'total_amount',
        label: 'Total amount',
        type: 'amount',
        description: '',
        required: false,
      },
      {
        key: 'billing_period',
        label: 'Billing period',
        type: 'period',
        description: '',
        required: false,
      },
    ],
  },
};
const waterBill: CategoryDefinition = {
  id: 'WATER_BILL',
  title: 'Water bill',
  description: '',
  template: {
    fields: [
      {
        key: 'provider',
        label: 'Utility',
        type: 'string',
        description: '',
        required: false,
      },
      {
        key: 'total_amount',
        label: 'Total',
        type: 'amount',
        description: '',
        required: true,
      },
      {
        key: 'water_consumption',
        label: 'Consumption',
        type: 'number',
        unit: 'm3',
        description: '',
        required: false,
      },
      {
        key: 'billing_period',
        label: 'Period',
        type: 'string',
        description: '',
        required: false,
      },
    ],
  },
};

const found = (key: string, value: string): RawFieldResult => ({
  key,
  status: 'found',
  value,
  candidates: [],
  note: null,
});

describe('buildExtractionPlan', () => {
  it('asks for a field shared by several templates once, and reports type clashes', () => {
    const plan = buildExtractionPlan([bill, waterBill], 'general.document@1');
    expect(plan.fields.map((field) => field.key)).toEqual([
      'provider',
      'total_amount',
      'billing_period',
      'water_consumption',
    ]);
    expect(plan.fields[1]).toMatchObject({
      categories: ['BILL', 'WATER_BILL'],
      required: true,
    });
    expect(plan.fields[2].type).toBe('period');
    expect(plan.warnings).toEqual([
      'Field "billing_period" is a period in BILL but a string in WATER_BILL; extracted as period',
    ]);
    expect(plan.target.targetKey).toBe('general.document@1');
  });

  it('falls back to the general target for an unknown key', () => {
    expect(buildExtractionPlan([], 'nope@1').target.targetKey).toBe(
      'general.document@1',
    );
  });
});

describe('normalizeFieldValue', () => {
  it.each([
    [{ type: 'amount' }, '1.234,56', 1234.56],
    [{ type: 'amount' }, '€ 7.47', 7.47],
    [{ type: 'number' }, '12,5', 12.5],
    [{ type: 'integer' }, '3', 3],
    [{ type: 'currency' }, 'eur', 'EUR'],
    [{ type: 'currency' }, '€', 'EUR'],
    [{ type: 'date' }, '2026-02-28', '2026-02-28'],
    [{ type: 'period' }, '2026-07-01/2026-08-31', '2026-07-01/2026-08-31'],
    [{ type: 'boolean' }, 'yes', true],
    [{ type: 'enum', options: ['card', 'cash'] }, 'Card', 'card'],
    [
      { type: 'string', pattern: '^(IT)?[0-9]{11}$' },
      'IT 01234567890',
      'IT01234567890',
    ],
  ] as const)('accepts %j %s', (field, raw, value) => {
    expect(normalizeFieldValue(field, raw)).toEqual({ ok: true, value });
  });

  it.each([
    [{ type: 'date' }, '2026-02-30'],
    [{ type: 'date' }, '30/01/2026'],
    [{ type: 'amount' }, 'about ten'],
    [{ type: 'amount' }, '1.234'],
    [{ type: 'integer' }, '2.5'],
    [{ type: 'currency' }, 'euros'],
    [{ type: 'period' }, '2026-08-31/2026-07-01'],
    [{ type: 'enum', options: ['card'] }, 'cheque'],
    [{ type: 'string', pattern: '^[0-9]{11}$' }, 'ABC'],
  ] as const)('rejects %j %s instead of coercing it', (field, raw) => {
    expect(normalizeFieldValue(field, raw).ok).toBe(false);
  });

  it('reads European and English number formats', () => {
    expect(parseNumber('1.234.567')).toBe(1234567);
    expect(parseNumber('1,234.50')).toBe(1234.5);
    expect(parseNumber('none')).toBeNull();
  });
});

describe('buildExtractedFields', () => {
  const plan = buildExtractionPlan([bill, waterBill], 'general.document@1');

  it('keeps every planned field and never fills one the model did not find', () => {
    const result = buildExtractedFields(plan, [
      found('provider', 'Acque Veronesi'),
      found('total_amount', '1.234,56'),
      {
        key: 'water_consumption',
        status: 'conflicting',
        value: null,
        candidates: ['42', '24'],
        note: 'Two readings on the bill',
      },
    ]);
    expect(result.fields['provider']).toMatchObject({
      value: 'Acque Veronesi',
      status: 'found',
    });
    expect(result.fields['total_amount']).toMatchObject({
      value: 1234.56,
      raw: '1.234,56',
      status: 'found',
    });
    expect(result.fields['billing_period']).toMatchObject({
      value: null,
      status: 'missing',
    });
    expect(result.fields['water_consumption']).toMatchObject({
      value: null,
      status: 'conflicting',
      candidates: ['42', '24'],
      unit: 'm3',
    });
    expect(result.warnings).toContain('Consumption: conflicting (42 / 24)');
  });

  it('marks a value that breaks its type invalid and warns about missing required fields', () => {
    const result = buildExtractedFields(plan, [found('total_amount', 'n/a')]);
    expect(result.fields['total_amount']).toMatchObject({
      status: 'invalid',
      value: null,
      raw: 'n/a',
    });
    expect(result.warnings).toEqual(
      expect.arrayContaining([
        'Total amount: "n/a" not a number',
        'Provider is required but missing',
      ]),
    );
  });
});

describe('mergeChunkResults', () => {
  it('prefers a found value, and turns disagreement into a conflict', () => {
    const merged = mergeChunkResults([
      [
        found('a', 'X'),
        found('b', '10'),
        { ...found('c', ''), status: 'missing', value: null },
      ],
      [{ ...found('a', ''), status: 'missing', value: null }, found('b', '12')],
    ]);
    expect(merged).toEqual([
      found('a', 'X'),
      {
        key: 'b',
        status: 'conflicting',
        value: null,
        candidates: ['10', '12'],
        note: 'Different parts of the document give different values',
      },
      { key: 'c', status: 'missing', value: null, candidates: [], note: null },
    ]);
  });
});

describe('splitText', () => {
  it('cuts at paragraph boundaries and keeps every character of content', () => {
    const text = ['a'.repeat(40), 'b'.repeat(40), 'c'.repeat(40)].join('\n\n');
    const chunks = splitText(text, 90);
    expect(chunks).toEqual([
      'a'.repeat(40) + '\n\n' + 'b'.repeat(40),
      'c'.repeat(40),
    ]);
    expect(splitText('short', 90)).toEqual(['short']);
  });
});
