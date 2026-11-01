import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { parseOrThrow } from '@life-island/be-nest';
import {
  categoryCountsQuerySchema,
  listRecordsQuerySchema,
  rejectRecordRequestSchema,
  updateRecordRequestSchema,
  type CategoryCountDto,
  type Page,
  type RecordDetailDto,
  type RecordDto,
} from '@life-island/contracts';
import { RecordsService } from './records.service.js';

@Controller('records')
export class RecordsController {
  constructor(
    @Inject(RecordsService) private readonly records: RecordsService,
  ) {}

  @Get()
  list(@Query() query: unknown): Promise<Page<RecordDto>> {
    return this.records.list(parseOrThrow(listRecordsQuerySchema, query));
  }

  /** Records per category under the other filters, descendants included in `total`. */
  @Get('category-counts')
  categoryCounts(@Query() query: unknown): Promise<CategoryCountDto[]> {
    return this.records.categoryCounts(
      parseOrThrow(categoryCountsQuerySchema, query),
    );
  }

  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string): Promise<RecordDetailDto> {
    return this.records.get(id);
  }

  /** Saves your corrections (details, target) to a record not confirmed yet. */
  @Patch(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ): Promise<RecordDetailDto> {
    return this.records.update(
      id,
      parseOrThrow(updateRecordRequestSchema, body),
    );
  }

  /** Confirms a parsed record; its data then travels to the domain that owns its category. */
  @Post(':id/confirm')
  @HttpCode(200)
  confirm(@Param('id', ParseUUIDPipe) id: string): Promise<RecordDetailDto> {
    return this.records.confirm(id);
  }

  /** Rejects a record: nothing is sent to a module. */
  @Post(':id/reject')
  @HttpCode(200)
  reject(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ): Promise<RecordDetailDto> {
    return this.records.reject(
      id,
      parseOrThrow(rejectRecordRequestSchema, body ?? {}),
    );
  }

  /** Brings a rejected record back to review. */
  @Post(':id/reopen')
  @HttpCode(200)
  reopen(@Param('id', ParseUUIDPipe) id: string): Promise<RecordDetailDto> {
    return this.records.reopen(id);
  }
}
