import {
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { parseOrThrow } from '@life-island/be-nest';
import {
  listRecordsQuerySchema,
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

  /** Confirms a parsed record; its data then travels to the domain that owns its category. */
  @Post(':id/confirm')
  @HttpCode(200)
  confirm(@Param('id', ParseUUIDPipe) id: string): Promise<RecordDetailDto> {
    return this.records.confirm(id);
  }
}
