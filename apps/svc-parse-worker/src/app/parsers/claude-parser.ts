import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import {
  DESCRIPTION_MAX_LENGTH,
  GENERAL_TARGET_KEY,
  TARGET_CATALOG,
  findTarget,
} from '@life-island/contracts';
import { z } from 'zod';
import type { NormalizedDocument } from '../normalize.js';
import {
  PermanentParseError,
  type DocumentParser,
  type ParseInput,
  type ParseResult,
  type ParseRunRecord,
} from './document-parser.js';

export const PROMPT_VERSION = 'classify-extract-1';
const LOW_CONFIDENCE = 0.8;

const classificationSchema = z.object({
  targetKey: z.enum(
    TARGET_CATALOG.map((target) => target.targetKey) as [string, ...string[]],
  ),
  description: z
    .string()
    .describe(
      `One sentence describing the document, at most ${DESCRIPTION_MAX_LENGTH} characters`,
    ),
  language: z.string().describe('ISO 639-1 code of the document language'),
  confidence: z.number().describe('0 to 1: how sure you are about targetKey'),
});
type Classification = z.infer<typeof classificationSchema>;

// Stable across requests so the prompt prefix is cached.
const CATALOG_TEXT = TARGET_CATALOG.map(
  (target) =>
    `- ${target.targetKey} (category "${target.category}"): ${target.description}`,
).join('\n');

const CLASSIFY_SYSTEM = `You sort personal documents (receipts, invoices, bills, medical papers, spreadsheets) for a life-management app.
Pick the single target that best fits the document from this catalog:
${CATALOG_TEXT}
Prefer a specific target over ${GENERAL_TARGET_KEY} whenever the document plausibly fits it. Report a low confidence when the image is unreadable or the document is ambiguous.`;

const EXTRACT_SYSTEM = `You extract structured data from personal documents for a life-management app.
Fill the JSON schema from what the document actually says. Copy names and numbers exactly; convert dates to ISO 8601 and amounts to numbers using a dot as decimal separator.
Leave optional fields out instead of guessing. A person reviews every record before it is saved.`;

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

/**
 * The AI parser: a fixed two-step workflow (docs/architecture.md, AI extraction).
 * 1. Classify with a small model against the target catalog.
 * 2. Extract with a stronger model, the target's JSON Schema as structured output.
 * 3. Validate with the target's Zod schema (domain rules included); on failure,
 *    one correction round that shows the model its errors.
 */
export class ClaudeParser implements DocumentParser {
  readonly name = 'claude';

  constructor(
    private readonly client: Anthropic,
    private readonly models: { classify: string; extract: string },
  ) {}

  async parse(input: ParseInput): Promise<ParseResult> {
    const runs: ParseRunRecord[] = [];
    const hints = `File name: ${input.filename}\nTitle given by the uploader: ${input.title}${
      input.description
        ? `\nDescription given by the uploader: ${input.description}`
        : ''
    }`;
    const content = documentBlock(input.document);

    const classification = await this.call<Classification>(runs, 'classify', {
      model: this.models.classify,
      max_tokens: 2000,
      system: [
        {
          type: 'text',
          text: CLASSIFY_SYSTEM,
          cache_control: { type: 'ephemeral' },
        },
      ],
      output_config: {
        effort: 'low',
        format: zodOutputFormat(classificationSchema),
      },
      messages: [
        {
          role: 'user',
          content: [
            content,
            { type: 'text', text: `${hints}\n\nClassify this document.` },
          ],
        },
      ],
    });
    const parsedClassification = classificationSchema.parse(classification);
    const target =
      findTarget(parsedClassification.targetKey) ??
      findTarget(GENERAL_TARGET_KEY)!;

    const format = zodOutputFormat(target.schema);
    const messages: Anthropic.Beta.BetaMessageParam[] = [
      {
        role: 'user',
        content: [
          content,
          {
            type: 'text',
            text: `${hints}\n\nThis document is a "${target.label}" (${target.targetKey}). Extract its details.`,
          },
        ],
      },
    ];
    const extractRequest = {
      model: this.models.extract,
      max_tokens: 16000,
      system: [
        {
          type: 'text' as const,
          text: EXTRACT_SYSTEM,
          cache_control: { type: 'ephemeral' as const },
        },
      ],
      output_config: { format },
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default' as const,
    };

    let raw = await this.call<unknown>(runs, 'extract', {
      ...extractRequest,
      messages,
    });
    let validation = target.schema.safeParse(raw);
    if (!validation.success) {
      messages.push(
        { role: 'assistant', content: JSON.stringify(raw) },
        {
          role: 'user',
          content: `The extracted data has these problems:\n${issuesOf(validation.error).join('\n')}\nCheck the document again and return corrected data. If the document itself is inconsistent, keep what it says.`,
        },
      );
      raw = await this.call<unknown>(runs, 'correct', {
        ...extractRequest,
        messages,
      });
      validation = target.schema.safeParse(raw);
    }

    const flags: string[] = [];
    if (parsedClassification.confidence < LOW_CONFIDENCE)
      flags.push('low_confidence');
    if (!validation.success) flags.push('needs_attention');
    return {
      targetKey: target.targetKey,
      category: target.category,
      description: parsedClassification.description.slice(
        0,
        DESCRIPTION_MAX_LENGTH,
      ),
      // Invalid data still goes to review, flagged, instead of being lost.
      details: validation.success ? validation.data : raw,
      confidence: Math.min(1, Math.max(0, parsedClassification.confidence)),
      flags,
      runs,
    };
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
      // 400s will fail the same way next time; rate limits, 5xx and network errors are retried.
      if (error instanceof Anthropic.BadRequestError)
        throw new PermanentParseError(run.error);
      throw error;
    }
  }
}
