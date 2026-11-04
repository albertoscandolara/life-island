import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import {
  CATEGORY_DIMENSIONS,
  CATEGORY_DIMENSION_LABELS,
  DESCRIPTION_MAX_LENGTH,
  GENERAL_TARGET_KEY,
  TARGET_CATALOG,
  TEMPLATE_FIELD_TYPES,
  findTarget,
} from '@life-island/contracts';
import { z } from 'zod';
import type { NormalizedDocument } from '../normalize.js';
import {
  buildExtractedFields,
  mergeChunkResults,
  splitText,
  type ExtractionPlan,
  type RawFieldResult,
} from '../templates.js';
import {
  ContextTooLargeError,
  PermanentParseError,
  type CategoryDefinition,
  type CategoryMatches,
  type Classification,
  type Discovery,
  type DiscoveryContext,
  type DocumentAnalyzer,
  type Extraction,
  type MatchContext,
  type ParseInput,
  type ParseRunRecord,
  type StepOutput,
} from './document-parser.js';
import { classifyProviderError } from './provider-errors.js';

export const PROMPT_VERSION = 'categories-4';
const LOW_CONFIDENCE = 0.8;

const GROUNDING = `Base every answer only on what the document itself shows. Never invent, guess or fill in information from general knowledge: when something is not in the document, say so.`;

// ---------------------------------------------------------------------------
// CLASSIFY

const CLASSIFY_INSTRUCTIONS = `You analyse personal documents of any kind (receipts, invoices, bills, payslips, bank statements, medical papers, contracts, letters, spreadsheets) for a life-management app.
${GROUNDING}

1. Identify the document type, its purpose and its useful characteristics (one-off or recurring, paid or to be paid, how it is paid, who issued it, who it is for).
2. Assign EVERY existing category that applies. A document usually has several: what it is (BILL, INVOICE, RECEIPT), what it is about (HOME, MEDICAL), its role (EXPENSE for money you pay, INCOME for money you receive, such as a payslip) and, when one exists, its issuer (for a payslip, the employer). Always use a broader category that applies, even when no specific one exists for this document. Give the evidence from the document for each category. Never assign a category the document does not support.
   Some categories belong to a dimension (document type, subject, property / location, person, issuer, attribute) and some sit under a parent category. A document has at most one document type and at most one issuer (a category together with its parents counts as one); list the best one first. Every dimension is optional: assign a property, a person or an issuer only when the document names it, never by default.
3. Choose the target where the extracted data will be reviewed:
${TARGET_CATALOG.map((target) => `- ${target.targetKey}: ${target.description}`).join('\n')}
   Prefer a specific target over ${GENERAL_TARGET_KEY} whenever the document plausibly fits it.
Report a low confidence when the document is unreadable or ambiguous.`;

function categoriesText(categories: CategoryDefinition[]): string {
  if (!categories.length) return 'There are no categories yet.';
  return categories
    .map((category) => {
      const traits = [
        category.dimension ? CATEGORY_DIMENSION_LABELS[category.dimension] : '',
        category.parentId ? `under ${category.parentId}` : '',
      ].filter(Boolean);
      return `- ${category.id} (${category.title}${traits.length ? `; ${traits.join(', ')}` : ''}): ${category.description}`;
    })
    .join('\n');
}

function classificationSchema(ids: string[]) {
  const id = ids.length ? z.enum(ids as [string, ...string[]]) : z.string();
  return z.object({
    documentType: z
      .string()
      .describe('What the document is, e.g. "water bill"'),
    purpose: z.string().describe('What it is for, in one sentence'),
    characteristics: z
      .array(z.string())
      .describe('Other useful traits shown by the document'),
    issuer: z
      .string()
      .nullable()
      .describe('Who issued it, as printed; null if not shown'),
    language: z.string().describe('ISO 639-1 code of the document language'),
    summary: z.string().describe('Two or three sentences on what it says'),
    description: z
      .string()
      .describe(
        `One sentence describing the document, at most ${DESCRIPTION_MAX_LENGTH} characters`,
      ),
    categories: z.array(
      z.object({
        id,
        evidence: z.string().describe('What in the document shows it applies'),
      }),
    ),
    targetKey: z.enum(
      TARGET_CATALOG.map((target) => target.targetKey) as [string, ...string[]],
    ),
    confidence: z.number().describe('0 to 1: how sure you are overall'),
  });
}
type ClassificationOutput = z.infer<ReturnType<typeof classificationSchema>>;

// ---------------------------------------------------------------------------
// EXTRACT

const EXTRACT_INSTRUCTIONS = `You extract structured data from personal documents for a life-management app.
${GROUNDING}

Return two things:
- "details": fill the target schema from what the document says. Copy names and numbers exactly; convert dates to ISO 8601 and amounts to numbers using a dot as decimal separator. Leave optional fields out instead of guessing.
- "fields": one entry for every requested field key, with a status:
  - found: the value is in the document. Write it in the field's format: dates YYYY-MM-DD, date-times ISO 8601, periods YYYY-MM-DD/YYYY-MM-DD, numbers and amounts with a dot as decimal separator and no thousands separator or currency sign, currency as an ISO 4217 code, booleans true or false, enum fields as one of the options.
  - missing: the document does not contain it.
  - illegible: it is there but cannot be read reliably.
  - ambiguous: it could be read in more than one way; list the readings in candidates.
  - conflicting: the document states different values; list them all in candidates.
  Value is null unless the status is found. Never derive a value from defaults, from other documents or from what is typical; a currency counts as found only when the document shows it (a code or a symbol such as €).
A person reviews every record before it is saved.`;

const RAW_FIELD_STATUSES = [
  'found',
  'missing',
  'illegible',
  'ambiguous',
  'conflicting',
] as const;

function extractionSchema(plan: ExtractionPlan) {
  const keys = plan.fields.map((field) => field.key);
  const field = z.object({
    key: keys.length ? z.enum(keys as [string, ...string[]]) : z.string(),
    status: z.enum(RAW_FIELD_STATUSES),
    value: z.string().nullable(),
    candidates: z.array(z.string()),
    note: z.string().nullable().describe('Why it is not found, or a caveat'),
  });
  return z.object({ details: plan.target.schema, fields: z.array(field) });
}

function fieldListText(plan: ExtractionPlan): string {
  if (!plan.fields.length)
    return 'No template fields are requested: return an empty "fields" list.';
  return [
    'Fields to report:',
    ...plan.fields.map(
      (field) =>
        `- ${field.key} (${field.type}${field.unit ? `, in ${field.unit}` : ''}${field.options ? `, one of: ${field.options.join(', ')}` : ''}${field.required ? ', required' : ''}): ${field.label}. ${field.description}`,
    ),
  ].join('\n');
}

// ---------------------------------------------------------------------------
// DISCOVER

const DISCOVER_INSTRUCTIONS = `You curate the category taxonomy of a personal document archive. Categories are reusable labels with an extraction template; a document can have many, and they are how the person will later find, group and total documents (every bill from ACQUE_VERONESI, everything about the house in TREGNAGO, every expense for a child).
${GROUNDING}

Propose the NEW categories this document calls for that no existing category or pending suggestion already covers. Go through every dimension and ask what this document shows for it:
- DOCUMENT_TYPE: what it is, as specific as is useful (ELECTRICITY_BILL under BILL, CAR_INSURANCE_POLICY).
- SUBJECT: what it is about (WATER_SUPPLY, CAR, SCHOOL).
- PROPERTY: the property or place it concerns, when it names one (a supply address, a rented flat, a car plate): name it by the place (TREGNAGO_HOUSE, VIA_ROMA_FLAT).
- PERSON: who it concerns, when it names a person other than a company (the account holder, the patient), by name as printed.
- ISSUER: who issued it (the utility, shop, insurer, employer, doctor, public office), with the name as printed and without the legal form (ACQUE_VERONESI for "Acque Veronesi S.c.a r.l.", ENEL, LIDL). When the document names its issuer and no existing issuer category is that issuer, ALWAYS propose it.
- ATTRIBUTE: lasting traits worth filtering on (RECURRING, DIRECT_DEBIT, TAX_DEDUCTIBLE).
Rules:
- Do this even when existing categories already apply: a document can be BILL, WATER_BILL and EXPENSE and still deserve ACQUE_VERONESI and TREGNAGO_HOUSE.
- A template field never replaces a category: an existing "provider" or "customer_id" field does not make an issuer category unnecessary.
- Values that change from one document to the next (dates, amounts, the billing period, invoice numbers) are not categories: they are template fields. Put lasting codes in the template of the category they belong to: the customer or contract number in the issuer's template, the supply point code (POD, PDR) or cadastral data in the property's.
- Never duplicate an existing or pending category by id, title or meaning (no synonyms, plurals, abbreviations or translations). If a pending suggestion fits the document, return it with exactly its id, title, description, dimension, parent and fields.
- Only propose what the document supports. Return an empty list when nothing useful is missing.
For each proposal give:
- id: UPPER_SNAKE_CASE in English; brand and issuer names as written (ACQUE_VERONESI, ENEL).
- title, and a description that says when to use the category.
- dimension: one of ${CATEGORY_DIMENSIONS.join(', ')}, or null for a general category.
- parentId: the id of an EXISTING category it belongs under (WATER_BILL under BILL, ACQUE_VERONESI under a WATER_UTILITY issuer category if one exists), or null. A subcategory has its parent's dimension.
- fields: 1 to 15 fields worth extracting from any future document of this category, each with a lower_snake_case key, label, type (${TEMPLATE_FIELD_TYPES.join(', ')}), description, whether it is required, a unit for quantities, and options for enum fields. Reuse an existing field key whenever the meaning is the same.`;

const discoverySchema = z.object({
  suggestions: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      description: z.string(),
      reason: z.string().describe('What in this document calls for it'),
      dimension: z.enum(CATEGORY_DIMENSIONS).nullable(),
      parentId: z
        .string()
        .nullable()
        .describe('Id of an existing category to put it under, or null'),
      fields: z.array(
        z.object({
          key: z.string(),
          label: z.string(),
          type: z.enum(TEMPLATE_FIELD_TYPES),
          description: z.string(),
          required: z.boolean(),
          unit: z.string().nullable(),
          options: z.array(z.string()),
        }),
      ),
    }),
  ),
});

function discoveryContextText(context: DiscoveryContext): string {
  const keys = new Map<string, string>();
  for (const category of context.categories)
    for (const field of category.template.fields)
      if (!keys.has(field.key)) keys.set(field.key, field.type);
  return [
    `Existing categories:\n${categoriesText(context.categories)}`,
    `Pending suggestions (not approved yet):\n${context.pending.length ? categoriesText(context.pending) : 'none'}`,
    `Never propose these rejected ids: ${context.rejectedIds.join(', ') || 'none'}`,
    `Field keys already in use: ${[...keys].map(([key, type]) => `${key} (${type})`).join(', ') || 'none'}`,
  ].join('\n\n');
}

/** What the classifier already read, so discovery starts from it. */
function analysisText(context: DiscoveryContext): string {
  const { analysis } = context;
  return [
    `This document is a ${analysis.documentType} (${analysis.purpose}).`,
    `Issued by: ${analysis.issuer ?? 'not shown'}.`,
    ...(analysis.characteristics.length
      ? [`Traits: ${analysis.characteristics.join('; ')}.`]
      : []),
    `It already has these categories: ${context.assignedIds.join(', ') || 'none'}.`,
  ].join('\n');
}

// ---------------------------------------------------------------------------
// RECLASSIFY (historical reclassification)

const RECLASSIFY_INSTRUCTIONS = `You keep a personal document archive's labels up to date. The archive gained new categories after this document was first read; decide which of these NEW categories apply to it.
${GROUNDING}

Rules:
- Consider only the candidate categories listed below; never name any other id.
- A candidate applies only when the document itself supports it. Give the evidence from the document and a confidence from 0 to 1.
- Some categories belong to a dimension (document type, subject, property / location, person, issuer, attribute) and some sit under a parent. A document has at most one document type and at most one issuer (a category together with its parents counts as one): never propose a document type or issuer that conflicts with the ones it already has, unless it is a more specific child of them.
- Every dimension is optional: propose a property, a person or an issuer only when the document names it.
- Return an empty list when none applies; that is the common case.`;

const RECLASSIFY_THRESHOLD = 0.5;

function matchSchema(ids: string[]) {
  return z.object({
    matches: z.array(
      z.object({
        id: z.enum(ids as [string, ...string[]]),
        evidence: z.string().describe('What in the document shows it applies'),
        confidence: z.number().describe('0 to 1'),
      }),
    ),
  });
}
type MatchOutput = z.infer<ReturnType<typeof matchSchema>>;

function matchContextText(context: MatchContext): string {
  const { analysis } = context;
  return [
    ...(analysis
      ? [
          `When first read, this document was a ${analysis.documentType} (${analysis.purpose}), issued by ${analysis.issuer ?? 'an issuer not shown'}.`,
        ]
      : []),
    `It already has these categories:\n${context.assigned.length ? categoriesText(context.assigned) : 'none'}`,
  ].join('\n');
}

// ---------------------------------------------------------------------------

function documentBlock(
  document: NormalizedDocument,
): Anthropic.Beta.BetaContentBlockParam {
  switch (document.kind) {
    case 'image':
      return {
        type: 'image',
        source: {
          type: 'base64',
          media_type: document.mediaType,
          data: document.data.toString('base64'),
        },
      };
    case 'pdf':
      return {
        type: 'document',
        source: {
          type: 'base64',
          media_type: 'application/pdf',
          data: document.data.toString('base64'),
        },
      };
    case 'text':
      return {
        type: 'text',
        text: `<document>\n${document.text}\n</document>`,
      };
  }
}

function textOf(message: Anthropic.Beta.BetaMessage): string {
  return message.content
    .filter(
      (block): block is Anthropic.Beta.BetaTextBlock => block.type === 'text',
    )
    .map((block) => block.text)
    .join('');
}

function issuesOf(error: z.ZodError): string[] {
  return error.issues.map(
    (issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`,
  );
}

function hintsOf(
  input: ParseInput,
  part?: { index: number; total: number },
): string {
  return [
    `File name: ${input.filename}`,
    `Title given by the uploader: ${input.title}`,
    ...(input.description
      ? [`Description given by the uploader: ${input.description}`]
      : []),
    ...(part
      ? [
          `This is part ${part.index + 1} of ${part.total} of a long document; answer from this part only.`,
        ]
      : []),
  ].join('\n');
}

/** Attaches the calls made so far to whatever error ends a step. */
function withRuns(error: unknown, runs: ParseRunRecord[]): unknown {
  if (error && typeof error === 'object')
    Object.assign(error, { runs: [...runs] });
  return error;
}

export interface ClaudeModels {
  classify: string;
  extract: string;
  discover: string;
  /** Historical reclassification; the classify model when not set. */
  reclassify?: string;
}

/**
 * The AI analyzer: three independent calls per document, each with structured
 * output (docs/architecture.md, AI extraction workflow). The worker runs them
 * in this order:
 * 1. Classify with a small model: type, purpose, existing categories, target.
 * 2. Discover new categories, independently of the matching in step 1.
 * 3. Extract with a stronger model: the target schema plus the fields of the
 *    templates of the assigned and suggested categories; one correction round
 *    if the target data breaks its schema's rules.
 * A text document too large for the context window is split into chunks.
 */
export class ClaudeParser implements DocumentAnalyzer {
  readonly name = 'claude';

  constructor(
    private readonly client: Anthropic,
    private readonly models: ClaudeModels,
    private readonly options: { chunkChars: number } = { chunkChars: 200_000 },
  ) {}

  async classify(
    input: ParseInput,
    categories: CategoryDefinition[],
  ): Promise<StepOutput<Classification>> {
    const runs: ParseRunRecord[] = [];
    try {
      const { result: output, split } = await this.firstPart(
        input,
        (part, info) =>
          this.call<ClassificationOutput>(runs, 'classify', {
            model: this.models.classify,
            max_tokens: 4000,
            system: [
              { type: 'text', text: CLASSIFY_INSTRUCTIONS },
              {
                type: 'text',
                text: `Existing categories:\n${categoriesText(categories)}`,
                cache_control: { type: 'ephemeral' },
              },
            ],
            output_config: {
              effort: 'low',
              format: zodOutputFormat(
                classificationSchema(categories.map((category) => category.id)),
              ),
            },
            messages: [
              {
                role: 'user',
                content: [
                  documentBlock(part.document),
                  {
                    type: 'text',
                    text: `${hintsOf(part, info)}\n\nAnalyse this document.`,
                  },
                ],
              },
            ],
          }),
      );
      const target =
        findTarget(output.targetKey) ?? findTarget(GENERAL_TARGET_KEY)!;
      const confidence = Math.min(1, Math.max(0, output.confidence));
      const flags: string[] = [];
      if (confidence < LOW_CONFIDENCE) flags.push('low_confidence');
      if (split) flags.push('long_document');
      return {
        runs,
        result: {
          analysis: {
            documentType: output.documentType,
            purpose: output.purpose,
            characteristics: output.characteristics,
            issuer: output.issuer,
            language: output.language,
            summary: output.summary,
            categoryEvidence: output.categories,
            confidence,
            warnings: split
              ? [
                  'Classified from the first part of a document too long to read at once',
                ]
              : [],
          },
          categoryIds: output.categories.map((category) => category.id),
          targetKey: target.targetKey,
          category: target.category,
          description: output.description.slice(0, DESCRIPTION_MAX_LENGTH),
          flags,
        },
      };
    } catch (error) {
      throw withRuns(error, runs);
    }
  }

  /**
   * Historical reclassification: which candidates (confirmed after the
   * document was last checked) apply. Small model; the candidate list is the
   * same for most documents of a run, so it sits in the cached system prompt.
   */
  async matchCategories(
    input: ParseInput,
    candidates: CategoryDefinition[],
    context: MatchContext,
  ): Promise<StepOutput<CategoryMatches>> {
    const runs: ParseRunRecord[] = [];
    if (!candidates.length) return { runs, result: { matches: [] } };
    const ids = candidates.map((category) => category.id);
    try {
      const { result: output } = await this.firstPart(input, (part, info) =>
        this.call<MatchOutput>(runs, 'reclassify', {
          model: this.models.reclassify ?? this.models.classify,
          max_tokens: 2000,
          system: [
            { type: 'text', text: RECLASSIFY_INSTRUCTIONS },
            {
              type: 'text',
              text: `Candidate categories:\n${categoriesText(candidates)}`,
              cache_control: { type: 'ephemeral' },
            },
          ],
          output_config: {
            effort: 'low',
            format: zodOutputFormat(matchSchema(ids)),
          },
          messages: [
            {
              role: 'user',
              content: [
                documentBlock(part.document),
                {
                  type: 'text',
                  text: `${hintsOf(part, info)}\n${matchContextText(context)}\n\nWhich candidate categories apply?`,
                },
              ],
            },
          ],
        }),
      );
      const seen = new Set<string>();
      const matches = (output.matches ?? [])
        .filter((match) => ids.includes(match.id) && !seen.has(match.id))
        .map((match) => {
          seen.add(match.id);
          return {
            categoryId: match.id,
            evidence: match.evidence.slice(0, 1000),
            confidence: Math.min(1, Math.max(0, match.confidence)),
          };
        })
        .filter((match) => match.confidence >= RECLASSIFY_THRESHOLD);
      return { runs, result: { matches } };
    } catch (error) {
      throw withRuns(error, runs);
    }
  }

  async extract(
    input: ParseInput,
    plan: ExtractionPlan,
  ): Promise<StepOutput<Extraction>> {
    const runs: ParseRunRecord[] = [];
    try {
      let parts: {
        details: unknown;
        fields: RawFieldResult[];
        valid: boolean;
      }[];
      try {
        parts = [await this.extractPart(runs, input, plan)];
      } catch (error) {
        if (!(error instanceof ContextTooLargeError)) throw error;
        parts = [];
        const chunks = this.chunksOf(input);
        for (const [index, chunk] of chunks.entries())
          parts.push(
            await this.extractPart(runs, chunk, plan, {
              index,
              total: chunks.length,
            }),
          );
      }
      const valid = parts.find((part) => part.valid);
      const flags: string[] = [];
      if (!valid) flags.push('needs_attention');
      if (parts.length > 1) flags.push('long_document');
      const fields = buildExtractedFields(
        plan,
        parts.length > 1
          ? mergeChunkResults(parts.map((part) => part.fields))
          : parts[0].fields,
      );
      if (parts.length > 1)
        fields.warnings.push(
          `Read in ${parts.length} parts; target details come from part ${parts.indexOf(valid ?? parts[0]) + 1}`,
        );
      return {
        runs,
        // Invalid data still goes to review, flagged, instead of being lost.
        result: { details: (valid ?? parts[0]).details, fields, flags },
      };
    } catch (error) {
      throw withRuns(error, runs);
    }
  }

  async discover(
    input: ParseInput,
    context: DiscoveryContext,
  ): Promise<StepOutput<Discovery>> {
    const runs: ParseRunRecord[] = [];
    try {
      const { result: output } = await this.firstPart(input, (part, info) =>
        this.call<z.infer<typeof discoverySchema>>(runs, 'discover', {
          model: this.models.discover,
          max_tokens: 16000,
          system: [
            { type: 'text', text: DISCOVER_INSTRUCTIONS },
            {
              type: 'text',
              text: discoveryContextText(context),
              cache_control: { type: 'ephemeral' },
            },
          ],
          output_config: { format: zodOutputFormat(discoverySchema) },
          betas: ['server-side-fallback-2026-07-01'],
          fallbacks: 'default',
          messages: [
            {
              role: 'user',
              content: [
                documentBlock(part.document),
                {
                  type: 'text',
                  text: `${hintsOf(part, info)}\n\n${analysisText(context)}\nWhich new categories should exist for it?`,
                },
              ],
            },
          ],
        }),
      );
      return {
        runs,
        result: {
          suggestions: output.suggestions.map((suggestion) => ({
            id: suggestion.id,
            title: suggestion.title,
            description: suggestion.description,
            reason: suggestion.reason,
            parentId: suggestion.parentId,
            dimension: suggestion.dimension,
            template: {
              fields: suggestion.fields.map(({ unit, options, ...field }) => ({
                ...field,
                ...(unit ? { unit } : {}),
                ...(options.length ? { options } : {}),
              })),
            },
          })),
        },
      };
    } catch (error) {
      throw withRuns(error, runs);
    }
  }

  private async extractPart(
    runs: ParseRunRecord[],
    input: ParseInput,
    plan: ExtractionPlan,
    part?: { index: number; total: number },
  ) {
    const schema = extractionSchema(plan);
    type Output = { details: unknown; fields: RawFieldResult[] };
    const messages: Anthropic.Beta.BetaMessageParam[] = [
      {
        role: 'user',
        content: [
          documentBlock(input.document),
          {
            type: 'text',
            text: `${hintsOf(input, part)}\n\nThis document is a "${plan.target.label}" (${plan.target.targetKey}).\n${fieldListText(plan)}\n\nExtract the details and the fields.`,
          },
        ],
      },
    ];
    const request = {
      model: this.models.extract,
      max_tokens: 16000,
      system: [
        {
          type: 'text' as const,
          text: EXTRACT_INSTRUCTIONS,
          cache_control: { type: 'ephemeral' as const },
        },
      ],
      output_config: { format: zodOutputFormat(schema) },
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default' as const,
    };
    let output = await this.call<Output>(runs, 'extract', {
      ...request,
      messages,
    });
    let validation = plan.target.schema.safeParse(output.details);
    if (!validation.success) {
      messages.push(
        { role: 'assistant', content: JSON.stringify(output) },
        {
          role: 'user',
          content: `The details have these problems:\n${issuesOf(validation.error).join('\n')}\nCheck the document again and return corrected details and fields. If the document itself is inconsistent, keep what it says.`,
        },
      );
      output = await this.call<Output>(runs, 'correct', {
        ...request,
        messages,
      });
      validation = plan.target.schema.safeParse(output.details);
    }
    return {
      details: validation.success ? validation.data : output.details,
      fields: output.fields ?? [],
      valid: validation.success,
    };
  }

  /**
   * Runs a call on the whole document; if it does not fit the context window,
   * on the first chunk of its text instead (enough to classify it or spot
   * missing categories). PDFs and images cannot be split here.
   */
  private async firstPart<T>(
    input: ParseInput,
    run: (
      part: ParseInput,
      info?: { index: number; total: number },
    ) => Promise<T>,
  ): Promise<{ result: T; split: boolean }> {
    try {
      return { result: await run(input), split: false };
    } catch (error) {
      if (!(error instanceof ContextTooLargeError)) throw error;
      const chunks = this.chunksOf(input);
      return {
        result: await run(chunks[0], { index: 0, total: chunks.length }),
        split: true,
      };
    }
  }

  private chunksOf(input: ParseInput): ParseInput[] {
    if (input.document.kind !== 'text')
      throw new PermanentParseError(
        'The document is too large for the model to read in one request',
      );
    const text = input.document.text;
    const size = Math.min(this.options.chunkChars, Math.ceil(text.length / 2));
    return splitText(text, size).map((chunk) => ({
      ...input,
      document: { kind: 'text', text: chunk },
    }));
  }

  private async call<T>(
    runs: ParseRunRecord[],
    step: ParseRunRecord['step'],
    request: Anthropic.Beta.MessageCreateParamsNonStreaming,
  ): Promise<T> {
    const started = Date.now();
    const run: ParseRunRecord = {
      step,
      model: request.model,
      promptVersion: PROMPT_VERSION,
    };
    runs.push(run);
    try {
      const message = await this.client.beta.messages.create(request);
      run.latencyMs = Date.now() - started;
      run.inputTokens = message.usage.input_tokens;
      run.outputTokens = message.usage.output_tokens;
      if (message.stop_reason === 'refusal') {
        throw new PermanentParseError(
          `The model declined to read this document (${message.stop_details?.category ?? 'no category'})`,
        );
      }
      if (message.stop_reason === 'max_tokens') {
        throw new PermanentParseError(
          'The model ran out of output tokens before finishing',
        );
      }
      const output = JSON.parse(textOf(message)) as T;
      run.rawOutput = output;
      return output;
    } catch (error) {
      run.latencyMs ??= Date.now() - started;
      run.error = error instanceof Error ? error.message : String(error);
      throw classifyProviderError(error);
    }
  }
}
