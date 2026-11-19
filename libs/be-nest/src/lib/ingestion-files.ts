import { internalHeaders } from '@life-island/be-common';
import { NotFoundException, type Provider } from '@nestjs/common';
import { Readable } from 'node:stream';

export interface FetchedFile {
  body: Readable;
  contentType: string;
  contentLength: number | null;
}

/** A file to file as a document: its bytes, name and type. */
export interface FileToStore {
  name: string;
  contentType: string;
  data: Buffer;
  /** The document's title in the documents app; the file name when missing. */
  title?: string;
  description?: string;
}

/** A file filed in svc-ingestion: its document id, or an earlier copy's. */
export interface StoredFile {
  uploadId: string;
  /** The same bytes were uploaded before; `uploadId` is that document. */
  duplicate: boolean;
}

/**
 * Reads and files documents through svc-ingestion's HTTP API: the files
 * belong to ingestion, and no other service touches its storage or tables.
 * Provide it with `ingestionFilesProvider(CONFIG)`.
 */
export class IngestionFiles {
  private readonly base: string;

  constructor(ingestionUrl: string) {
    this.base = ingestionUrl.replace(/\/+$/, '');
  }

  async open(
    uploadId: string,
    disposition: 'preview' | 'download' = 'download',
  ): Promise<FetchedFile> {
    const response = await fetch(
      `${this.base}/uploads/${encodeURIComponent(uploadId)}/${disposition}`,
      { headers: internalHeaders() },
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

  /**
   * Files a document the way the browser does (create, send the bytes,
   * complete), so it lands in the documents app and is parsed like any other.
   */
  async store(file: FileToStore): Promise<StoredFile> {
    const created = await this.call<{ uploadId: string }>('POST', '/uploads', {
      filename: file.name,
      mimeType: file.contentType,
      sizeBytes: file.data.length,
      title: file.title?.slice(0, 200) || undefined,
      description: file.description?.slice(0, 255) || undefined,
    });
    const id = encodeURIComponent(created.uploadId);
    const sent = await fetch(`${this.base}/uploads/${id}/file`, {
      method: 'PUT',
      headers: {
        ...internalHeaders(),
        'Content-Type': 'application/octet-stream',
      },
      body: new Uint8Array(file.data),
    });
    if (!sent.ok)
      throw new Error(
        `svc-ingestion answered ${sent.status} to the file of ${file.name}`,
      );
    const done = await this.call<{
      upload: { id: string };
      duplicate: boolean;
    }>('POST', `/uploads/${id}/complete`, {});
    return { uploadId: done.upload.id, duplicate: done.duplicate };
  }

  private async call<T>(
    method: string,
    path: string,
    body: unknown,
  ): Promise<T> {
    const response = await fetch(`${this.base}${path}`, {
      method,
      headers: { ...internalHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!response.ok)
      throw new Error(
        `svc-ingestion answered ${response.status} to ${method} ${path}: ${(await response.text()).slice(0, 300)}`,
      );
    return (await response.json()) as T;
  }
}

/** Nest provider of `IngestionFiles`, from a config with `ingestionUrl`. */
export function ingestionFilesProvider(configToken: symbol): Provider {
  return {
    provide: IngestionFiles,
    useFactory: (config: { ingestionUrl: string }) =>
      new IngestionFiles(config.ingestionUrl),
    inject: [configToken],
  };
}
