import {
  Controller,
  Get,
  Inject,
  Param,
  ParseUUIDPipe,
  StreamableFile,
} from '@nestjs/common';
import { IngestionFiles } from './ingestion-files.js';

@Controller('documents')
export class DocumentsController {
  constructor(@Inject(IngestionFiles) private readonly files: IngestionFiles) {}

  /** Shows an ID document's original file, streamed from svc-ingestion. */
  @Get(':uploadId/preview')
  async preview(
    @Param('uploadId', ParseUUIDPipe) uploadId: string,
  ): Promise<StreamableFile> {
    const file = await this.files.open(uploadId, 'preview');
    return new StreamableFile(file.body, {
      type: file.contentType,
      disposition: 'inline',
      length: file.contentLength ?? undefined,
    });
  }
}
