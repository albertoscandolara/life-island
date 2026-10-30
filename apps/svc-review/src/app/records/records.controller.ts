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
  listRecordsQuerySchema,
  updateRecordRequestSchema,
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

  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string): Promise<RecordDetailDto> {
    return this.records.get(id);
  }

  /** Saves your corrections to the details of a record not confirmed yet. */
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
}
