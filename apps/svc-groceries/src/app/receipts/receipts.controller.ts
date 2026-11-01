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

  /** Spending per month and item category. */
  @Get('spending')
  spending(): Promise<SpendingDto[]> {
    return this.receipts.spending();
  }
}
