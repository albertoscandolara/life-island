import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { Readable } from 'node:stream';
import { CONFIG, type Tax730Config } from '../config.js';

export interface FetchedFile {
  body: Readable;
  contentType: string;
  contentLength: number | null;
}

/**
 * Reads original files from svc-ingestion's HTTP API: the files belong to
 * ingestion, and this service never touches its storage or tables.
 */
@Injectable()
export class IngestionFiles {
  constructor(@Inject(CONFIG) private readonly config: Tax730Config) {}

  async open(
    uploadId: string,
    disposition: 'preview' | 'download' = 'download',
  ): Promise<FetchedFile> {
    const response = await fetch(
      `${this.config.ingestionUrl}/uploads/${encodeURIComponent(uploadId)}/${disposition}`,
    );
    if (response.status === 404)
      throw new NotFoundException(`File of document ${uploadId} not found`);
    if (!response.ok || !response.body)
      throw new Error(
        `svc-ingestion answered ${response.status} for document ${uploadId}`,
      );
    const length = response.headers.get('content-length');
    return {
      body: Readable.fromWeb(
        response.body as import('node:stream/web').ReadableStream,
      ),
      contentType:
        response.headers.get('content-type') ?? 'application/octet-stream',
      contentLength: length ? Number(length) : null,
    };
  }

  async read(uploadId: string): Promise<Buffer> {
    const file = await this.open(uploadId);
    const chunks: Buffer[] = [];
    for await (const chunk of file.body) chunks.push(Buffer.from(chunk));
    return Buffer.concat(chunks);
  }
}
