import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
  type OnApplicationBootstrap,
} from '@nestjs/common';
import type { ServiceDb } from '@life-island/be-common';
import {
  AiAssistant,
  aiFileBlock,
  IngestionFiles,
  type AiAssistantStep,
  type AiContentBlock,
  type AiFile,
  type FetchedFile,
} from '@life-island/be-nest';
import {
  MONEY_CATEGORY_LABELS,
  RECEIPT_CONTENT_TYPES,
  RECEIPT_MAX_BYTES,
  RECEIPT_MAX_FILES,
  euroText,
  receiptReadingOutputSchema,
  type MovementAttachmentDto,
  type ReceiptReadingDto,
  type ReceiptReadingOutput,
} from '@life-island/contracts';
import { and, asc, eq, inArray } from 'drizzle-orm';
import { CONFIG, SERVICE_DB, type ServiceConfig } from '../config.js';
import {
  transactionAttachments,
  transactions,
  type TransactionAttachmentRow,
} from '../db/schema.js';

/** The receipt reader (AI_TOOLS in libs/contracts settings.ts). */
export const RECEIPT_TOOL = 'money.receipt-reader';

export const RECEIPT_INSTRUCTIONS = `You read receipts and online orders for a personal finance app in Italy: photos of a shop receipt (scontrino), screenshots of an order page (Amazon and other shops), order emails or PDF invoices. Several files can be the same purchase (two photos of one long receipt, or an order in parts).

Return:
- merchant: the shop or platform as people name it ("Amazon", "Esselunga", "MediaWorld"), never the legal entity.
- date: the order or purchase day, YYYY-MM-DD, or "" when not shown.
- total: what was paid in euro after discounts and promotions (the grand total, "Totale", "Importo pagato"), positive; 0 when not shown.
- channel: online for an order placed on a website or an app, store for a receipt from a shop.
- category: the category of the biggest part of the purchase, one of: ${Object.entries(
  MONEY_CATEGORY_LABELS,
)
  .filter(([id]) => !['salary', 'other-income', 'savings'].includes(id))
  .map(([id, label]) => `${id} (${label})`)
  .join(
    ', ',
  )}. Food, drinks and household consumables (detergent, toilet paper, kitchen paper) are groceries; clothes, electronics, furniture, sport gear and objects are shopping; medicines are health.
- splits: only when some lines belong to another category than \`category\`: one part per other category with the sum of its lines. Leave it empty when everything is one category. The parts never add up to more than the total.
- note: what was bought, short and searchable, the main items with their price ("ACE detergent x2 €26.64, Foxy toilet paper 60 rolls €39.00").
- items: the lines, short names with what each cost, the most expensive first, at most 30.

Read only what the files show. If a file is not a receipt or an order, say so in the note and return total 0.`;

const READ_STEP: AiAssistantStep = {
  stepId: 'read',
  label: 'Read the receipt',
  system: RECEIPT_INSTRUCTIONS,
  userTemplate:
    '{the receipts, order screenshots or PDFs}\n\n{What I know: the movement (day, amount, description) when it is one already, and my note}',
  outputFormat: 'receiptReadingOutput',
  effort: 'low',
  maxTokens: 4000,
};

/** A file sent from the browser (multer's shape). */
export interface UploadedReceipt {
  originalname: string;
  mimetype: string;
  buffer: Buffer;
}

export function toAiFiles(uploaded: readonly UploadedReceipt[]): AiFile[] {
  return uploaded.map((f) => ({
    name: f.originalname.slice(0, 200) || 'receipt',
    contentType: f.mimetype,
    data: f.buffer,
  }));
}

/** Checks the receipts before anything is stored or sent. */
export function checkReceiptFiles(files: readonly AiFile[]): void {
  if (!files.length)
    throw new BadRequestException(
      'Add at least one receipt: a photo, a screenshot or a PDF',
    );
  if (files.length > RECEIPT_MAX_FILES)
    throw new BadRequestException(
      `Add at most ${RECEIPT_MAX_FILES} files at a time`,
    );
  for (const file of files) {
    const type = file.contentType.split(';')[0].trim().toLowerCase();
    if (!(RECEIPT_CONTENT_TYPES as readonly string[]).includes(type))
      throw new BadRequestException(
        `${file.name}: add a JPEG, PNG or WebP photo, or a PDF`,
      );
    if (file.data.length > RECEIPT_MAX_BYTES)
      throw new BadRequestException(
        `${file.name}: a file can be at most ${RECEIPT_MAX_BYTES / 1024 / 1024} MB`,
      );
  }
}

/**
 * A reading made safe to apply: amounts rounded and positive, parts that are
 * not the main category, merged by category, and never more than the total.
 */
export function cleanReading(
  reading: ReceiptReadingOutput,
): ReceiptReadingOutput {
  const round = (v: number) => Math.round(Math.abs(v) * 100) / 100;
  const total = round(reading.total);
  const merged = new Map<string, number>();
  for (const part of reading.splits) {
    if (part.category === reading.category || !(round(part.amount) > 0))
      continue;
    merged.set(
      part.category,
      round((merged.get(part.category) ?? 0) + part.amount),
    );
  }
  let splits = [...merged].map(([category, amount]) => ({
    category: category as ReceiptReadingOutput['category'],
    amount,
  }));
  const sum = splits.reduce((s, p) => s + p.amount, 0);
  if (total > 0 && sum > total + 0.005) splits = [];
  return {
    ...reading,
    merchant: reading.merchant.trim().slice(0, 120),
    date: /^\d{4}-\d{2}-\d{2}$/.test(reading.date) ? reading.date : '',
    total,
    splits,
    note: reading.note.trim().slice(0, 500),
    items: reading.items.slice(0, 30).map((i) => ({
      name: i.name.trim().slice(0, 120),
      amount: round(i.amount),
    })),
  };
}

export function toAttachmentDto(
  row: TransactionAttachmentRow,
): MovementAttachmentDto {
  return {
    id: row.id,
    uploadId: row.uploadId,
    name: row.name,
    contentType: row.contentType,
    createdAt: row.createdAt.toISOString(),
  };
}

/**
 * Receipts, order screenshots and photos filed with movements, and the
 * receipt reader. The files are documents of svc-ingestion: they show in the
 * documents app too, and removing one here only forgets the link.
 */
@Injectable()
export class ReceiptsService implements OnApplicationBootstrap {
  private readonly ai: AiAssistant;
  private readonly logger = new Logger(ReceiptsService.name);

  constructor(
    @Inject(CONFIG) config: ServiceConfig,
    @Inject(SERVICE_DB) private readonly svc: ServiceDb,
    @Inject(IngestionFiles) private readonly files: IngestionFiles,
  ) {
    this.ai = new AiAssistant({
      toolId: RECEIPT_TOOL,
      service: 'svc-money',
      apiKey: config.anthropicApiKey,
      defaultModel: config.aiModel,
      svc,
    });
  }

  async onApplicationBootstrap(): Promise<void> {
    await this.ai.describe([READ_STEP]);
  }

  /** Whether reading a receipt calls the model now. */
  usesAi(): Promise<boolean> {
    return this.ai.active();
  }

  private get db() {
    return this.svc.db;
  }

  /** The attachments of these movements, by movement id. */
  async byMovement(
    ids: readonly string[],
  ): Promise<Map<string, MovementAttachmentDto[]>> {
    const map = new Map<string, MovementAttachmentDto[]>();
    if (!ids.length) return map;
    const rows = await this.db
      .select()
      .from(transactionAttachments)
      .where(inArray(transactionAttachments.transactionId, [...ids]))
      .orderBy(asc(transactionAttachments.createdAt));
    for (const row of rows)
      map.set(row.transactionId, [
        ...(map.get(row.transactionId) ?? []),
        toAttachmentDto(row),
      ]);
    return map;
  }

  private async movement(id: string) {
    const [row] = await this.db
      .select()
      .from(transactions)
      .where(eq(transactions.id, id));
    if (!row) throw new NotFoundException('Movement not found');
    return row;
  }

  /** Files the receipts as documents and links them to the movement. */
  async attach(
    transactionId: string,
    files: readonly AiFile[],
  ): Promise<MovementAttachmentDto[]> {
    checkReceiptFiles(files);
    const movement = await this.movement(transactionId);
    const existing = await this.db
      .select({ id: transactionAttachments.id })
      .from(transactionAttachments)
      .where(eq(transactionAttachments.transactionId, transactionId));
    if (existing.length + files.length > RECEIPT_MAX_FILES * 2)
      throw new BadRequestException(
        `A movement keeps at most ${RECEIPT_MAX_FILES * 2} files`,
      );
    const title = `Receipt: ${movement.description}`.slice(0, 200);
    const description =
      `${movement.date}, ${euroText(Math.abs(Number(movement.amount)))}, filed in Money`.slice(
        0,
        255,
      );
    const saved: MovementAttachmentDto[] = [];
    for (const file of files) {
      let stored;
      try {
        stored = await this.files.store({ ...file, title, description });
      } catch (error) {
        this.logger.error(`Could not file ${file.name}: ${String(error)}`);
        throw new ServiceUnavailableException(
          'The documents service did not take the file: try again in a moment.',
        );
      }
      const [row] = await this.db
        .insert(transactionAttachments)
        .values({
          transactionId,
          uploadId: stored.uploadId,
          name: file.name,
          contentType: file.contentType.split(';')[0].trim().toLowerCase(),
        })
        .onConflictDoNothing()
        .returning();
      if (row) saved.push(toAttachmentDto(row));
    }
    return saved;
  }

  /** Forgets an attachment; the document stays in the documents app. */
  async detach(transactionId: string, attachmentId: string): Promise<void> {
    const rows = await this.db
      .delete(transactionAttachments)
      .where(
        and(
          eq(transactionAttachments.id, attachmentId),
          eq(transactionAttachments.transactionId, transactionId),
        ),
      )
      .returning({ id: transactionAttachments.id });
    if (!rows.length) throw new NotFoundException('Attachment not found');
  }

  /** The file of an attachment, streamed from svc-ingestion. */
  async preview(attachmentId: string): Promise<FetchedFile> {
    const [row] = await this.db
      .select()
      .from(transactionAttachments)
      .where(eq(transactionAttachments.id, attachmentId));
    if (!row) throw new NotFoundException('Attachment not found');
    return this.files.open(row.uploadId, 'preview');
  }

  /** Reads receipts you are about to file (a new cash expense). */
  async read(files: readonly AiFile[], note: string | null) {
    checkReceiptFiles(files);
    await this.requireAi();
    return this.ask(files, note ? `My note: ${note}` : null);
  }

  /** Reads the receipts already filed with a movement. */
  async readMovement(transactionId: string): Promise<ReceiptReadingDto> {
    const movement = await this.movement(transactionId);
    await this.requireAi();
    const rows = await this.db
      .select()
      .from(transactionAttachments)
      .where(eq(transactionAttachments.transactionId, transactionId))
      .orderBy(asc(transactionAttachments.createdAt))
      .limit(RECEIPT_MAX_FILES);
    if (!rows.length)
      throw new BadRequestException(
        'Add a receipt to this movement first, then read it.',
      );
    const files: AiFile[] = [];
    for (const row of rows)
      files.push({
        name: row.name,
        contentType: row.contentType,
        data: await this.files.read(row.uploadId),
      });
    const facts = [
      `The movement: ${movement.date}, ${euroText(Number(movement.amount))}, "${movement.description}".`,
      movement.notes ? `My note: ${movement.notes}` : null,
    ]
      .filter(Boolean)
      .join('\n');
    return this.ask(files, facts);
  }

  /** Nothing is read (or downloaded) while the reader is off. */
  private async requireAi(): Promise<void> {
    if (!(await this.ai.active()))
      throw new ServiceUnavailableException(
        'The receipt reader is off: turn it on in Settings → AI tools (it needs a Claude API key).',
      );
  }

  private async ask(
    files: readonly AiFile[],
    facts: string | null,
  ): Promise<ReceiptReadingDto> {
    const content: AiContentBlock[] = [];
    for (const file of files) {
      const block = aiFileBlock(file);
      if (block) content.push(block);
    }
    content.push({
      type: 'text',
      text: [
        `${files.length === 1 ? 'This file is' : `These ${files.length} files are`} one purchase.`,
        facts,
      ]
        .filter(Boolean)
        .join('\n\n'),
    });
    const answer = await this.ai.ask({
      step: READ_STEP,
      user: content,
      output: receiptReadingOutputSchema,
    });
    return { reading: cleanReading(answer.output), model: answer.model };
  }
}
