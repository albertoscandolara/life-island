import {
  BadRequestException,
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
  Put,
  Query,
  Redirect,
  StreamableFile,
} from '@nestjs/common';
import { parseOrThrow } from '@life-island/be-nest';
import {
  abandonUploadRequestSchema,
  createUploadRequestSchema,
  listUploadsQuerySchema,
  reparseUploadsRequestSchema,
  updateUploadRequestSchema,
  type CompleteUploadResponse,
  type CreateUploadResponse,
  type Page,
  type ReparseUploadsResponse,
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

  /**
   * Fallback when the browser cannot send the file to storage itself: the
   * raw bytes (`application/octet-stream`) come here and the API stores them.
   */
  @Put(':id/file')
  @HttpCode(204)
  receiveFile(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ): Promise<void> {
    if (!Buffer.isBuffer(body))
      throw new BadRequestException(
        'Send the file as application/octet-stream',
      );
    return this.uploads.receiveFile(id, body);
  }

  /** Retries an upload whose file never arrived: a fresh URL for the same document. */
  @Post(':id/restart')
  @HttpCode(200)
  restart(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<CreateUploadResponse> {
    return this.uploads.restart(id);
  }

  /** The browser could not send the file: marks the upload FAILED with the reason. */
  @Post(':id/abandon')
  @HttpCode(200)
  abandon(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ): Promise<UploadDto> {
    return this.uploads.abandon(
      id,
      parseOrThrow(abandonUploadRequestSchema, body).reason,
    );
  }

  /**
   * Sends parsed documents back to the parse queue: the AI assigns their
   * categories and reads their fields again from scratch.
   */
  @Post('reparse')
  @HttpCode(200)
  reparse(@Body() body: unknown): Promise<ReparseUploadsResponse> {
    return this.uploads.reparse(
      parseOrThrow(reparseUploadsRequestSchema, body),
    );
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

  /** Deletes the document and its file; a module keeps what it already loaded. */
  @Delete(':id')
  @HttpCode(204)
  remove(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.uploads.remove(id);
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
