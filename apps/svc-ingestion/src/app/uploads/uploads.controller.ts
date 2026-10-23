import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Redirect,
} from '@nestjs/common';
import { parseOrThrow } from '@life-island/be-nest';
import {
  createUploadRequestSchema,
  listUploadsQuerySchema,
  type CompleteUploadResponse,
  type CreateUploadResponse,
  type Page,
  type UploadDto,
} from '@life-island/contracts';
import { UploadsService } from './uploads.service.js';

@Controller('uploads')
export class UploadsController {
  constructor(
    @Inject(UploadsService) private readonly uploads: UploadsService,
  ) {}

  @Post()
  create(@Body() body: unknown): Promise<CreateUploadResponse> {
    return this.uploads.create(parseOrThrow(createUploadRequestSchema, body));
  }

  @Post(':id/complete')
  @HttpCode(200)
  complete(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<CompleteUploadResponse> {
    return this.uploads.complete(id);
  }

  @Get()
  list(@Query() query: unknown): Promise<Page<UploadDto>> {
    return this.uploads.list(parseOrThrow(listUploadsQuerySchema, query));
  }

  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string): Promise<UploadDto> {
    return this.uploads.get(id);
  }

  /** Redirects to a short-lived presigned link to the original file. */
  @Get(':id/file')
  @Redirect()
  async file(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<{ url: string; statusCode: number }> {
    return { url: await this.uploads.fileUrl(id), statusCode: 302 };
  }
}
