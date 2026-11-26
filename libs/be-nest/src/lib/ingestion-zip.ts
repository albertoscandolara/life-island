import { Logger } from '@nestjs/common';
import JSZip from 'jszip';
import type { Readable } from 'node:stream';
import type { IngestionFiles } from './ingestion-files.js';

/** One original file in a zip: the document and its path inside the zip. */
export interface ZipFileEntry {
  uploadId: string;
  path: string;
}

export interface ZipFromIngestionOptions {
  /** The files to read from svc-ingestion, each at its path. */
  files: readonly ZipFileEntry[];
  /** Files made on the spot (a summary workbook), added as they are. */
  extra?: readonly { path: string; body: Buffer | string }[];
  /**
   * The note to add, given the paths of the files that could not be read
   * (maybe none); null adds none.
   */
  missingNote?: (paths: string[]) => { path: string; text: string } | null;
  /** How many files are read at a time. */
  concurrency?: number;
}

const logger = new Logger('ZipFromIngestion');

/**
 * A zip of original files read from svc-ingestion (a few at a time, each
 * once), streamed as it is written. A file that cannot be read is left out
 * and named in the missing note: one broken file never breaks the download.
 */
export async function zipFromIngestion(
  ingestion: Pick<IngestionFiles, 'read'>,
  options: ZipFromIngestionOptions,
): Promise<Readable> {
  const zip = new JSZip();
  for (const file of options.extra ?? []) zip.file(file.path, file.body);
  const bytes = await readAll(
    ingestion,
    options.files.map((f) => f.uploadId),
    options.concurrency ?? 4,
  );
  const missing: string[] = [];
  for (const file of options.files) {
    const body = bytes.get(file.uploadId);
    if (body) zip.file(file.path, body);
    else missing.push(file.path);
  }
  const note = options.missingNote?.(missing) ?? null;
  if (note) zip.file(note.path, note.text);
  return zip.generateNodeStream({
    type: 'nodebuffer',
    streamFiles: true,
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
  }) as Readable;
}

/** Each file once, a few at a time; a file that cannot be read is left out. */
async function readAll(
  ingestion: Pick<IngestionFiles, 'read'>,
  uploadIds: string[],
  concurrency: number,
): Promise<Map<string, Buffer>> {
  const out = new Map<string, Buffer>();
  const queue = [...new Set(uploadIds)];
  const worker = async () => {
    for (let id = queue.shift(); id; id = queue.shift()) {
      try {
        out.set(id, await ingestion.read(id));
      } catch (error) {
        logger.warn(`Could not read document ${id}: ${String(error)}`);
      }
    }
  };
  await Promise.all(Array.from({ length: concurrency }, worker));
  return out;
}

/** "DOCUMENTI NON DISPONIBILI.txt" in the zip's root folder, one line per file. */
export function unavailableFilesNote(
  root: string,
): (paths: string[]) => { path: string; text: string } | null {
  return (paths) =>
    paths.length
      ? {
          path: `${root}/DOCUMENTI NON DISPONIBILI.txt`,
          text:
            'Questi file non erano disponibili al momento del download:\r\n\r\n' +
            paths
              .map(
                (p) =>
                  `- ${p.startsWith(`${root}/`) ? p.slice(root.length + 1) : p}`,
              )
              .join('\r\n') +
            '\r\n',
        }
      : null;
}
