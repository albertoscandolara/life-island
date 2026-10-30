import type { ExtractedFields } from '@life-island/contracts';
import {
  editFieldValues,
  FieldEditError,
  syncTemplateFields,
} from './upload-edits.js';

const extracted: ExtractedFields = {
  fields: {
    total_amount: {
      label: 'Total amount',
      type: 'amount',
      value: 10,
      status: 'found',
      required: true,
      categories: ['BILL'],
    },
    meter: {
      label: 'Meter',
      type: 'string',
      value: null,
      status: 'conflicting',
      candidates: ['A1', 'A7'],
      required: false,
      categories: ['WATER_BILL'],
    },
    kind: {
      label: 'Kind',
      type: 'enum',
      value: null,
      status: 'missing',
      required: false,
      categories: ['BILL'],
    },
  },
  warnings: ['Meter: conflicting (A1 / A7)', 'Template clash on "x"'],
};

describe('editFieldValues', () => {
  const now = new Date('2026-10-30T08:00:00Z');

  it('checks and normalizes your values, keeping the parser reading', () => {
    const result = editFieldValues(
      extracted,
      { total_amount: '12,50', meter: 'A7' },
      [],
      now,
    );
    expect(result.fields['total_amount']).toMatchObject({
      value: 12.5,
      status: 'found',
      raw: '10',
      note: 'Edited by you',
      editedAt: now.toISOString(),
    });
    expect(result.fields['meter']).toMatchObject({
      value: 'A7',
      status: 'found',
      candidates: [],
    });
    // The resolved conflict's warning goes; others stay.
    expect(result.warnings).toEqual(['Template clash on "x"']);
  });

  it('clears a value, warning when the field is required', () => {
    const result = editFieldValues(extracted, { total_amount: null }, [], now);
    expect(result.fields['total_amount']).toMatchObject({
      value: null,
      status: 'missing',
    });
    expect(result.warnings).toContain('Total amount is required but missing');
  });

  it('uses the template for enum options', () => {
    const templates = [
      {
        key: 'kind',
        label: 'Kind',
        type: 'enum' as const,
        description: '',
        required: false,
        options: ['final', 'estimate'],
      },
    ];
    expect(
      editFieldValues(extracted, { kind: 'Final' }, templates, now).fields[
        'kind'
      ].value,
    ).toBe('final');
    expect(() =>
      editFieldValues(extracted, { kind: 'other' }, templates, now),
    ).toThrow(FieldEditError);
  });

  it('refuses unknown fields, wrong types and documents not extracted yet', () => {
    expect(() => editFieldValues(extracted, { nope: '1' })).toThrow(
      'no field "nope"',
    );
    expect(() => editFieldValues(extracted, { total_amount: 'ten' })).toThrow(
      'Total amount: not a number',
    );
    expect(() => editFieldValues(null, { total_amount: '1' })).toThrow(
      FieldEditError,
    );
  });
});

describe('syncTemplateFields', () => {
  it('adds a new category’s fields as missing and drops empty fields no category asks for', () => {
    const result = syncTemplateFields(extracted, [
      {
        id: 'BILL',
        template: {
          fields: [
            {
              key: 'total_amount',
              label: 'Total amount',
              type: 'amount',
              description: '',
              required: true,
            },
          ],
        },
      },
      {
        id: 'GAS_BILL',
        template: {
          fields: [
            {
              key: 'gas_consumption',
              label: 'Gas used',
              type: 'number',
              description: '',
              required: false,
              unit: 'Smc',
            },
          ],
        },
      },
    ])!;
    expect(Object.keys(result.fields).sort()).toEqual([
      'gas_consumption',
      'kind',
      'total_amount',
    ]);
    expect(result.fields['gas_consumption']).toMatchObject({
      status: 'missing',
      value: null,
      unit: 'Smc',
      categories: ['GAS_BILL'],
    });
    // WATER_BILL left: its empty field and its warning go.
    expect(result.warnings).toEqual(['Template clash on "x"']);
  });

  it('keeps a field that holds a value even when no category asks for it', () => {
    const result = syncTemplateFields(extracted, [])!;
    expect(result.fields['total_amount']).toMatchObject({
      value: 10,
      categories: [],
    });
    expect(result.fields['meter']).toBeUndefined();
  });

  it('leaves a document that was not extracted yet alone', () => {
    expect(syncTemplateFields(null, [])).toBeNull();
  });
});
