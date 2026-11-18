import {
  Controller,
  Get,
  Inject,
  Param,
  ParseUUIDPipe,
  Query,
} from '@nestjs/common';
import { parseOrThrow } from '@life-island/be-nest';
import {
  listReceiptsQuerySchema,
  payablesQuerySchema,
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
  ) {}

  @Get('receipts')
  list(@Query() query: unknown): Promise<Page<ReceiptDto>> {
    return this.receipts.list(parseOrThrow(listReceiptsQuerySchema, query));
  }

  @Get('receipts/:id')
  get(@Param('id', ParseUUIDPipe) id: string): Promise<ReceiptDetailDto> {
    return this.receipts.get(id);
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
