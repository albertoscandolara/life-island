import type { DocumentRow } from '../db/schema.js';
import { documentAmount, documentDate } from './document-view.js';
import { scorePaymentCandidate } from './payment-candidates.js';

const row = (overrides: Partial<DocumentRow> = {}): DocumentRow => ({
  uploadId: crypto.randomUUID(),
  title: 'Documento',
  description: null,
  originalFilename: 'file.pdf',
  fileFormat: 'PDF',
  categories: [],
  fields: null,
  uploadedAt: new Date('2025-07-02T10:00:00Z'),
  metadataUpdatedAt: null,
  deletedAt: null,
  ...overrides,
});

describe('reading a document', () => {
  it('finds its main date and amount among its fields', () => {
    expect(
      documentDate({ issue_date: '2025-07-16', due_date: '2025-08-01' }),
    ).toBe('2025-07-16');
    expect(documentDate({ execution_date: '2025-06-27T00:00:00Z' })).toBe(
      '2025-06-27',
    );
    expect(documentDate({ note: 'none' })).toBeNull();
    expect(documentAmount({ total_amount: 6500 })).toBe(6500);
    expect(documentAmount({ transfer_amount: '6500,00' })).toBe(6500);
    expect(documentAmount(null)).toBeNull();
  });
});

describe('payment proof suggestions', () => {
  const expense = {
    amount: 6500,
    issuer: 'Notaio Chiliberti Avv. Giuseppe',
    date: '2025-06-27',
  };

  it('ranks a transfer to the same supplier for the same amount first', () => {
    const transfer = scorePaymentCandidate(
      expense,
      row({
        title: 'Bonifico a Chiliberti',
        categories: ['BANK_TRANSFER'],
        fields: { total_amount: 6500, execution_date: '2025-06-27' },
      }),
    );
    const unrelated = scorePaymentCandidate(
      expense,
      row({ title: 'Bolletta acqua', fields: { total_amount: 42 } }),
    );
    expect(transfer.score).toBe(7);
    expect(transfer.reasons).toEqual([
      'Same amount',
      'Mentions Notaio Chiliberti Avv. Giuseppe',
      'Same day',
      'Looks like a payment',
    ]);
    expect(unrelated.score).toBe(0);
  });
});
