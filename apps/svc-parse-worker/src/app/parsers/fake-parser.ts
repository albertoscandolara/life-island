import {
  GENERAL_TARGET_KEY,
  findTarget,
  type GeneralDocumentV1,
  type GroceryReceiptV1,
  type Tax730ExpenseV1,
} from '@life-island/contracts';
import type {
  DocumentParser,
  ParseInput,
  ParseResult,
} from './document-parser.js';

const GROCERY_WORDS =
  /(receipt|scontrino|spesa|esselunga|coop|conad|lidl|carrefour|market|grocery)/i;
const TAX_WORDS =
  /(farmacia|pharmacy|medic|doctor|dottor|ticket|visita|clinic|scuola|school)/i;

/**
 * Offline stand-in for the AI parser. It classifies by keywords in the file
 * name, title and text, and fills details that are valid for the chosen
 * target, so the whole pipeline and the review UI work without an API key.
 * Every record it produces carries the `fake_parser` flag.
 */
export class FakeParser implements DocumentParser {
  readonly name = 'fake';

  async parse(input: ParseInput): Promise<ParseResult> {
    const haystack = [
      input.filename,
      input.title,
      input.description ?? '',
      input.document.kind === 'text' ? input.document.text.slice(0, 2000) : '',
    ].join(' ');
    const today = new Date().toISOString().slice(0, 10);
    const targetKey = TAX_WORDS.test(haystack)
      ? 'tax730.expense@1'
      : GROCERY_WORDS.test(haystack)
        ? 'grocery.receipt@1'
        : GENERAL_TARGET_KEY;
    const target = findTarget(targetKey)!;

    let details: GroceryReceiptV1 | Tax730ExpenseV1 | GeneralDocumentV1;
    if (targetKey === 'grocery.receipt@1') {
      details = {
        merchant: { name: 'Demo Market', address: 'Via Roma 1, Milano' },
        purchasedAt: `${today}T10:30:00Z`,
        currency: 'EUR',
        total: 7.47,
        paymentMethod: 'card',
        items: [
          {
            rawName: 'LATTE INTERO 1L',
            normalizedName: 'Whole milk 1 L',
            category: 'dairy',
            quantity: 2,
            unitPrice: 1.29,
            lineTotal: 2.58,
          },
          {
            rawName: 'PANE CASERECCIO',
            normalizedName: 'Homemade bread',
            category: 'bakery',
            quantity: 1,
            lineTotal: 2.4,
          },
          {
            rawName: 'MELE GOLDEN',
            normalizedName: 'Golden apples',
            category: 'produce',
            quantity: 1,
            lineTotal: 2.49,
          },
        ],
      };
    } else if (targetKey === 'tax730.expense@1') {
      details = {
        taxYear: Number(today.slice(0, 4)),
        expenseType: 'medicines',
        frame730: 'E1',
        date: today,
        amount: 18.9,
        traceablePayment: true,
        issuer: 'Farmacia Demo',
      };
    } else {
      details = {
        documentType: 'document',
        date: today,
        summary: `Sample details for "${input.title}". Set PARSER=claude to extract real data.`,
        keyFacts: [{ label: 'File', value: input.filename }],
      };
    }
    target.schema.parse(details);
    return {
      targetKey,
      category: target.category,
      description: input.description
        ? undefined
        : `${target.label} (sample data)`,
      details,
      confidence: 0.5,
      flags: ['fake_parser'],
      runs: [
        {
          step: 'classify',
          model: 'fake',
          promptVersion: 'fake-1',
          rawOutput: { targetKey },
        },
      ],
    };
  }
}
