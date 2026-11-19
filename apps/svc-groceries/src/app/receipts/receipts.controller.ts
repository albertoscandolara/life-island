import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  ParseUUIDPipe,
  Patch,
  Query,
  StreamableFile,
} from '@nestjs/common';
import { IngestionFiles, parseOrThrow } from '@life-island/be-nest';
import {
  listReceiptsQuerySchema,
  payablesQuerySchema,
  receiptUpdateRequestSchema,
  type PayableDto,
  type Page,
  type ReceiptDetailDto,
  type ReceiptDto,
  type SpendingDto,
} from '@life-island/contracts';
import { ReceiptsService } from './receipts.service.js';

@Controller()
export class ReceiptsController {
  constructor(
    @Inject(ReceiptsService) private readonly receipts: ReceiptsService,
    @Inject(IngestionFiles) private readonly files: IngestionFiles,
  ) {}

  @Get('receipts')
  list(@Query() query: unknown): Promise<Page<ReceiptDto>> {
    return this.receipts.list(parseOrThrow(listReceiptsQuerySchema, query));
  }

  @Get('receipts/:id')
  get(@Param('id', ParseUUIDPipe) id: string): Promise<ReceiptDetailDto> {
    return this.receipts.get(id);
  }

  /** Renames it (`title`; empty shows the shop's name), or keeps it out of Groceries (`notGroceries`). */
  @Patch('receipts/:id')
  @HttpCode(204)
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ): Promise<void> {
    return this.receipts.update(
      id,
      parseOrThrow(receiptUpdateRequestSchema, body ?? {}),
    );
  }

  /** Shows the document the receipt was read from, streamed from svc-ingestion. */
  @Get('receipts/:id/document')
  async document(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<StreamableFile> {
    const file = await this.files.open(
      await this.receipts.uploadOf(id),
      'preview',
    );
    return new StreamableFile(file.body, {
      type: file.contentType,
      disposition: 'inline',
      length: file.contentLength ?? undefined,
    });
  }

  /** The receipts paid by card, for Money matching (docs/guides/money-matching.md). */
  @Get('payables')
  payables(@Query() query: unknown): Promise<PayableDto[]> {
    return this.receipts.payables(parseOrThrow(payablesQuerySchema, query));
  }

  /** Spending per month and item category. */
  @Get('spending')
  spending(): Promise<SpendingDto[]> {
    return this.receipts.spending();
  }
}
