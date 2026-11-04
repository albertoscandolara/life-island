import {
  Controller,
  Get,
  Inject,
  Param,
  ParseUUIDPipe,
  Query,
  StreamableFile,
} from '@nestjs/common';
import type { ServiceDb } from '@life-island/be-common';
import { parseOrThrow } from '@life-island/be-nest';
import {
  listHomeDocumentsQuerySchema,
  type HomeDocumentDto,
} from '@life-island/contracts';
import { and, desc, ilike, isNull } from 'drizzle-orm';
import { SERVICE_DB } from '../config.js';
import { documents } from '../db/schema.js';
import { documentAmount, documentDate } from './document-view.js';
import { IngestionFiles } from './ingestion-files.js';

@Controller('documents')
export class DocumentsController {
  constructor(
    @Inject(SERVICE_DB) private readonly svc: ServiceDb,
    @Inject(IngestionFiles) private readonly files: IngestionFiles,
  ) {}

  /** Your documents, newest first, to attach to a work (invoices, quotes, photos). */
  @Get()
  async list(@Query() query: unknown): Promise<HomeDocumentDto[]> {
    const { search, limit } = parseOrThrow(listHomeDocumentsQuerySchema, query);
    const rows = await this.svc.db
      .select()
      .from(documents)
      .where(
        and(
          isNull(documents.deletedAt),
          search
            ? ilike(documents.title, `%${search.replace(/[%_\\]/g, '\\$&')}%`)
            : undefined,
        ),
      )
      .orderBy(desc(documents.uploadedAt))
      .limit(limit);
    return rows.map((row) => ({
      uploadId: row.uploadId,
      title: row.title,
      categories: row.categories,
      date: documentDate(row.fields),
      amount: documentAmount(row.fields),
      uploadedAt: row.uploadedAt.toISOString(),
    }));
  }

  /** Shows a document's original file, streamed from svc-ingestion. */
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
