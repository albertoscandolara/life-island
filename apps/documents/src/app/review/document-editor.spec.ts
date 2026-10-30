import type { UploadDto } from '@life-island/contracts';
import { fieldText, uploadChanges } from './document-editor';

const upload = {
  id: 'u1',
  title: 'Bolletta',
  description: 'Acqua',
  categories: ['BILL', 'WATER_BILL'],
  extractedFields: {
    fields: {
      total_amount: {
        label: 'Total amount',
        type: 'amount',
        value: 12.5,
        status: 'found',
        required: true,
        categories: ['BILL'],
      },
      paid: {
        label: 'Paid',
        type: 'boolean',
        value: true,
        status: 'found',
        required: false,
        categories: ['BILL'],
      },
      due_date: {
        label: 'Due date',
        type: 'date',
        value: null,
        status: 'missing',
        required: false,
        categories: ['BILL'],
      },
    },
    warnings: [],
  },
} as unknown as UploadDto;

const unchanged = {
  title: 'Bolletta',
  description: 'Acqua',
  categories: ['BILL', 'WATER_BILL'],
  fields: { total_amount: '12.5', paid: 'yes', due_date: '' },
};

describe('uploadChanges', () => {
  it('sends nothing when nothing changed', () => {
    expect(uploadChanges(upload, unchanged)).toEqual({});
  });

  it('sends only what you changed', () => {
    expect(
      uploadChanges(upload, {
        ...unchanged,
        description: '  ',
        categories: ['WATER_BILL', 'BILL', 'HOME'],
        fields: { ...unchanged.fields, due_date: '2026-11-15', paid: '' },
      }),
    ).toEqual({
      description: null,
      categories: ['WATER_BILL', 'BILL', 'HOME'],
      fields: { due_date: '2026-11-15', paid: null },
    });
  });
});

describe('fieldText', () => {
  it('shows a value as editable text', () => {
    const fields = upload.extractedFields!.fields;
    expect(fieldText(fields['total_amount'])).toBe('12.5');
    expect(fieldText(fields['paid'])).toBe('yes');
    expect(fieldText(fields['due_date'])).toBe('');
  });
});
