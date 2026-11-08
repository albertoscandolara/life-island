import {
  Body,
  Controller,
  Get,
  Inject,
  Param,
  ParseUUIDPipe,
  Patch,
  Query,
} from '@nestjs/common';
import { parseOrThrow } from '@life-island/be-nest';
import {
  listBillsQuerySchema,
  updateBillRequestSchema,
  type BillDto,
} from '@life-island/contracts';
import { BillsService } from './bills.service.js';

@Controller('bills')
export class BillsController {
  constructor(@Inject(BillsService) private readonly bills: BillsService) {}

  @Get()
  list(@Query() query: unknown): Promise<BillDto[]> {
    return this.bills.list(parseOrThrow(listBillsQuerySchema, query));
  }

  /** Your corrections; answers the bill as it now reads, or null once excluded. */
  @Patch(':uploadId')
  async update(
    @Param('uploadId', ParseUUIDPipe) uploadId: string,
    @Body() body: unknown,
  ): Promise<{ bill: BillDto | null }> {
    return {
      bill: await this.bills.update(
        uploadId,
        parseOrThrow(updateBillRequestSchema, body),
      ),
    };
  }
}
