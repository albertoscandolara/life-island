import type { ExtractedField } from '@life-island/contracts';
import type { CategoryDefinition } from './parsers/document-parser.js';
import { reviewReasons, type ParsedDocument } from './review-readiness.js';

const category = (
  id: string,
  dimension: CategoryDefinition['dimension'],
  parentId: string | null = null,
): CategoryDefinition => ({
  id,
  title: id,
  description: '',
  template: { fields: [] },
  parentId,
  dimension,
});
const categories = [
  category('BILL', 'DOCUMENT_TYPE'),
  category('GAS_BILL', 'DOCUMENT_TYPE', 'BILL'),
  category('LETTER', 'DOCUMENT_TYPE'),
  category('VIA_DEI_BANDI', 'PROPERTY'),
  category('AGSM', 'ISSUER'),
  category('ID_DOCUMENT', 'DOCUMENT_TYPE'),
  category('PASSPORT', 'DOCUMENT_TYPE', 'ID_DOCUMENT'),
  // The subtypes stay top-level when you already had an "ID document".
  category('DRIVING_LICENCE', 'DOCUMENT_TYPE'),
];
const found = (value: number | string): ExtractedField => ({
  label: '',
  type: 'string',
  value,
  status: 'found',
  required: true,
  categories: [],
});
const bill: ParsedDocument = {
  confidence: 0.95,
  flags: [],
  categories: ['GAS_BILL', 'AGSM', 'VIA_DEI_BANDI'],
  targetKey: 'general.document@1',
  extractedFields: {
    fields: { total_amount: found(61.2), provider: found('AGSM') },
    warnings: [],
  },
  pendingSuggestions: 0,
};

describe('reviewReasons', () => {
  it('lets a sure, complete bill of a known home through', () => {
    expect(reviewReasons(bill, categories)).toEqual([]);
  });

  it('holds a bill back when it has no home', () => {
    expect(
      reviewReasons({ ...bill, categories: ['GAS_BILL', 'AGSM'] }, categories),
    ).toEqual(['NO_PROPERTY']);
  });

  it('names everything there is to check', () => {
    expect(
      reviewReasons(
        {
          confidence: 0.6,
          flags: ['fake_parser'],
          categories: ['AGSM'],
          targetKey: 'grocery.receipt@1',
          extractedFields: {
            fields: {
              total_amount: {
                ...found(0),
                value: null,
                status: 'conflicting',
              },
            },
            warnings: [],
          },
          pendingSuggestions: 2,
        },
        categories,
      ),
    ).toEqual([
      'OFFLINE_PARSER',
      'LOW_CONFIDENCE',
      'DOUBTFUL_FIELDS',
      'NEW_CATEGORIES',
      'NO_DOCUMENT_TYPE',
      'MODULE',
    ]);
  });

  it('counts a required field that was not found as a doubt', () => {
    expect(
      reviewReasons(
        {
          ...bill,
          categories: ['LETTER'],
          extractedFields: {
            fields: {
              total_amount: { ...found(0), value: null, status: 'missing' },
            },
            warnings: [],
          },
        },
        categories,
      ),
    ).toEqual(['DOUBTFUL_FIELDS']);
  });

  it('always holds an ID document back for its person data', () => {
    const passport: ParsedDocument = {
      ...bill,
      categories: ['PASSPORT'],
      extractedFields: {
        fields: { last_name: found('ROSSI'), document_number: found('YA1') },
        warnings: [],
      },
    };
    expect(reviewReasons(passport, categories)).toEqual(['PERSON_DATA']);
    expect(
      reviewReasons({ ...passport, categories: ['ID_DOCUMENT'] }, categories),
    ).toEqual(['PERSON_DATA']);
    expect(
      reviewReasons(
        { ...passport, categories: ['DRIVING_LICENCE'] },
        categories,
      ),
    ).toEqual(['PERSON_DATA']);
  });
});
