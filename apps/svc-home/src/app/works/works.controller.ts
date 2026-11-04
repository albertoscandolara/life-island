import {
  Body,
  Controller,
  Delete,
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
  attachWorkDocumentRequestSchema,
  createWorkRequestSchema,
  listWorksQuerySchema,
  updateWorkRequestSchema,
  type WorkDto,
} from '@life-island/contracts';
import { WorksService } from './works.service.js';

@Controller('works')
export class WorksController {
  constructor(@Inject(WorksService) private readonly works: WorksService) {}

  @Get()
  list(@Query() query: unknown): Promise<WorkDto[]> {
    return this.works.list(parseOrThrow(listWorksQuerySchema, query));
  }

  @Post()
  create(@Body() body: unknown): Promise<WorkDto> {
    return this.works.create(parseOrThrow(createWorkRequestSchema, body));
  }

  @Patch(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ): Promise<WorkDto> {
    return this.works.update(id, parseOrThrow(updateWorkRequestSchema, body));
  }

  @Delete(':id')
  @HttpCode(204)
  remove(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.works.remove(id);
  }

  @Post(':id/documents')
  attach(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ): Promise<WorkDto> {
    const { uploadId } = parseOrThrow(attachWorkDocumentRequestSchema, body);
    return this.works.attach(id, uploadId);
  }

  @Delete(':id/documents/:uploadId')
  detach(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('uploadId', ParseUUIDPipe) uploadId: string,
  ): Promise<WorkDto> {
    return this.works.detach(id, uploadId);
  }
}
