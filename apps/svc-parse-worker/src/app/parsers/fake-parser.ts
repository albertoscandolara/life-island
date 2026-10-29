import {
  GENERAL_TARGET_KEY,
  findTarget,
  type GeneralDocumentV1,
  type GroceryReceiptV1,
  type Tax730ExpenseV1,
} from '@life-island/contracts';
import {
  buildExtractedFields,
  type ExtractionPlan,
  type RawFieldResult,
} from '../templates.js';
import {
  QuotaExhaustedError,
  type CategoryDefinition,
  type Classification,
  type Discovery,
  type DiscoveryContext,
  type DocumentAnalyzer,
  type Extraction,
  type ParseInput,
  type ParseRunRecord,
  type ProposedCategory,
  type StepOutput,
} from './document-parser.js';

const GROCERY_WORDS =
  /(receipt|scontrino|spesa|esselunga|coop|conad|lidl|carrefour|market|grocery)/i;
const TAX_WORDS =
  /(farmacia|pharmacy|medic|doctor|dottor|ticket|visita|clinic|scuola|school)/i;

/** Keyword rules for the categories the fake parser can recognize. */
const CATEGORY_WORDS: Record<string, RegExp> = {
  GROCERIES: /(spesa|esselunga|coop|conad|lidl|carrefour|supermarket|grocery)/i,
  RECEIPT: /(receipt|scontrino)/i,
  INVOICE: /(fattura|invoice)/i,
  BILL: /(bolletta|bill\b|utility|fornitura)/i,
  WATER_BILL: /(acqua|water|acque)/i,
  HOME: /(bolletta|affitto|rent|condominio|acqua|luce|gas\b)/i,
  MEDICAL: /(farmacia|pharmacy|medic|doctor|dottor|visita|clinic)/i,
  TAX_DEDUCTIBLE: /(farmacia|pharmacy|medic|visita|scuola|school)/i,
  EXPENSE:
    /(total|totale|importo|€|eur\b|receipt|scontrino|fattura|bolletta|invoice)/i,
};

/** Categories the fake parser proposes when it sees these words and they do not exist yet. */
const DISCOVERABLE: (ProposedCategory & { words: RegExp })[] = [
  {
    id: 'ELECTRICITY_BILL',
    title: 'Electricity bill',
    description:
      'A bill for electricity supply, usually with consumption in kWh.',
    reason: 'The document mentions electricity',
    words: /(electricity|energia elettrica|\bluce\b|kwh)/i,
    template: {
      fields: [
        {
          key: 'provider',
          label: 'Provider',
          type: 'string',
          description: '',
          required: true,
        },
        {
          key: 'electricity_consumption',
          label: 'Electricity consumption',
          type: 'number',
          unit: 'kWh',
          description: '',
          required: false,
        },
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
  ...['ENEL', 'LIDL', 'ESSELUNGA', 'CONAD'].map((name) => ({
    id: name,
    title: name.charAt(0) + name.slice(1).toLowerCase(),
    description: `Documents issued by ${name.charAt(0) + name.slice(1).toLowerCase()}.`,
    reason: `The document is issued by ${name}`,
    words: new RegExp(`\\b${name}\\b`, 'i'),
    template: {
      fields: [
        {
          key: 'issue_date',
          label: 'Issue date',
          type: 'date' as const,
          description: '',
          required: false,
        },
        {
          key: 'total_amount',
          label: 'Total amount',
          type: 'amount' as const,
          description: '',
          required: false,
        },
      ],
    },
  })),
];

function haystackOf(input: ParseInput): string {
  return [
    input.filename,
    input.title,
    input.description ?? '',
    input.document.kind === 'text' ? input.document.text.slice(0, 4000) : '',
  ].join(' ');
}

/** dd/mm/yyyy or dd-mm-yyyy → YYYY-MM-DD. */
function firstDate(text: string): string | null {
  const match = /\b(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})\b/.exec(text);
  if (!match) return null;
  return `${match[3]}-${match[2].padStart(2, '0')}-${match[1].padStart(2, '0')}`;
}

/**
 * Offline stand-in for the AI analyzer. It classifies by keywords in the file
 * name, title and text, reads only the few fields a regular expression can
 * find (totals, dates, currency) and leaves every other field missing, so the
 * whole pipeline and the review UI work without an API key. The target
 * details are sample data, flagged `fake_parser`.
 *
 * `quota` simulates a provider usage quota: after `steps` AI steps in a
 * period it fails with QuotaExhaustedError until the period ends, which is
 * how the pause and resume flow can be tried locally.
 */
export class FakeParser implements DocumentAnalyzer {
  readonly name = 'fake';
  private used = 0;
  private periodStart = Date.now();

  constructor(
    private readonly quota: { steps: number; periodMinutes: number } = {
      steps: 0,
      periodMinutes: 60,
    },
  ) {}

  async classify(
    input: ParseInput,
    categories: CategoryDefinition[],
  ): Promise<StepOutput<Classification>> {
    this.spend();
    const haystack = haystackOf(input);
    const targetKey = TAX_WORDS.test(haystack)
      ? 'tax730.expense@1'
      : GROCERY_WORDS.test(haystack)
        ? 'grocery.receipt@1'
        : GENERAL_TARGET_KEY;
    const target = findTarget(targetKey)!;
    const categoryIds = categories
      .filter((category) => {
        const words = CATEGORY_WORDS[category.id];
        return words
          ? words.test(haystack)
          : new RegExp(`\\b${category.id.replace(/_/g, '[ _]')}\\b`, 'i').test(
              haystack,
            );
      })
      .map((category) => category.id);
    return {
      runs: [this.run('classify', { targetKey, categoryIds })],
      result: {
        analysis: {
          documentType: target.label.toLowerCase(),
          purpose: 'Sample analysis from the offline parser',
          characteristics: [],
          issuer: null,
          language: 'it',
          summary: `Keyword match on "${input.title}". Set PARSER=claude to analyse it for real.`,
          categoryEvidence: categoryIds.map((id) => ({
            id,
            evidence: 'keyword match',
          })),
          confidence: 0.5,
          warnings: [],
        },
        categoryIds,
        targetKey,
        category: target.category,
        description: input.description
          ? undefined
          : `${target.label} (sample data)`,
        flags: ['fake_parser'],
      },
    };
  }

  async extract(
    input: ParseInput,
    plan: ExtractionPlan,
  ): Promise<StepOutput<Extraction>> {
    this.spend();
    const text = haystackOf(input);
    const total =
      /tota(?:le|l)\s*(?:eur|€)?\s*([\d.,]+\d)/i.exec(text)?.[1] ?? null;
    const date = firstDate(text);
    const currency = /€|\beur\b/i.test(text) ? 'EUR' : null;
    const found: Record<string, string | null> = {
      total_amount: total,
      currency,
      issue_date: date,
      purchase_date: date,
      expense_date: date,
    };
    const reported: RawFieldResult[] = plan.fields.map((field) => {
      const value = found[field.key] ?? null;
      return {
        key: field.key,
        status: value ? 'found' : 'missing',
        value,
        candidates: [],
        note: value
          ? null
          : 'The offline parser only reads totals, dates and currency',
      };
    });
    return {
      runs: [this.run('extract', { fields: reported.length })],
      result: {
        details: this.sampleDetails(plan.target.targetKey, input),
        fields: buildExtractedFields(plan, reported),
        flags: ['fake_parser'],
      },
    };
  }

  async discover(
    input: ParseInput,
    context: DiscoveryContext,
  ): Promise<StepOutput<Discovery>> {
    this.spend();
    const haystack = haystackOf(input);
    const suggestions = DISCOVERABLE.filter((candidate) =>
      candidate.words.test(haystack),
    ).map((candidate): ProposedCategory => ({
      id: candidate.id,
      title: candidate.title,
      description: candidate.description,
      reason: candidate.reason,
      template: candidate.template,
    }));
    return {
      runs: [
        this.run('discover', {
          suggestions: suggestions.map((s) => s.id),
          known: context.categories.length,
        }),
      ],
      result: { suggestions },
    };
  }

  private spend(): void {
    if (!this.quota.steps) return;
    const period = this.quota.periodMinutes * 60_000;
    if (Date.now() - this.periodStart >= period) {
      this.periodStart = Date.now();
      this.used = 0;
    }
    if (this.used >= this.quota.steps) {
      const resetAt = new Date(this.periodStart + period);
      const message = `Simulated usage quota of ${this.quota.steps} steps reached; you will regain access on ${resetAt.toISOString()}`;
      throw new QuotaExhaustedError(
        message,
        { status: 402, type: 'billing_error', message },
        resetAt,
      );
    }
    this.used++;
  }

  private run(
    step: ParseRunRecord['step'],
    rawOutput: unknown,
  ): ParseRunRecord {
    return { step, model: 'fake', promptVersion: 'fake-2', rawOutput };
  }

  private sampleDetails(targetKey: string, input: ParseInput): unknown {
    const today = new Date().toISOString().slice(0, 10);
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
    findTarget(targetKey)!.schema.parse(details);
    return details;
  }
}
