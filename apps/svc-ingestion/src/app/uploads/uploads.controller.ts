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
  Redirect,
  StreamableFile,
} from '@nestjs/common';
import { parseOrThrow } from '@life-island/be-nest';
import {
  createUploadRequestSchema,
  listUploadsQuerySchema,
  updateUploadRequestSchema,
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

  /** Edit the title, description, categories or extracted field values. */
  @Patch(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ): Promise<UploadDto> {
    return this.uploads.update(
      id,
      parseOrThrow(updateUploadRequestSchema, body),
    );
  }

  /** Shows the original file in the browser (`Content-Disposition: inline`). */
  @Get(':id/preview')
  preview(@Param('id', ParseUUIDPipe) id: string): Promise<StreamableFile> {
    return this.stream(id, 'inline');
  }

  /** Downloads the original file under its original name (`Content-Disposition: attachment`). */
  @Get(':id/download')
  download(@Param('id', ParseUUIDPipe) id: string): Promise<StreamableFile> {
    return this.stream(id, 'attachment');
  }

  /** Redirects to a short-lived presigned link to the original file. */
  @Get(':id/file')
  @Redirect()
  async file(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<{ url: string; statusCode: number }> {
    return { url: await this.uploads.fileUrl(id), statusCode: 302 };
  }

  private async stream(
    id: string,
    disposition: 'inline' | 'attachment',
  ): Promise<StreamableFile> {
    const file = await this.uploads.openFile(id, disposition);
    return new StreamableFile(file.body, {
      type: file.contentType,
      disposition: file.contentDisposition,
      length: file.sizeBytes,
    });
  }
}
