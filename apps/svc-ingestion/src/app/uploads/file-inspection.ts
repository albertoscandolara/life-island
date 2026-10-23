import { createHash } from 'node:crypto';
import {
  FILE_FORMAT_MIME_TYPES,
  fileFormatFromFilename,
  fileFormatFromMime,
  type FileFormat,
} from '@life-island/contracts';
import { fileTypeFromBuffer } from 'file-type';

export interface InspectedFile {
  format: FileFormat;
  mime: string;
  sha256: string;
}

const TEXT_FORMATS: readonly FileFormat[] = ['CSV', 'TXT'];

/** True when the first bytes contain no NUL and decode as UTF-8, i.e. a plain-text file. */
function looksLikeText(bytes: Buffer): boolean {
  const sample = bytes.subarray(0, 8192);
  if (sample.includes(0)) return false;
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(sample);
    return true;
  } catch {
    return false;
  }
}

/**
 * Works out the real format from the file's bytes (magic numbers), never from
 * what the browser claimed. Text formats have no magic number, so CSV and TXT
 * fall back to the declared type once the bytes are confirmed to be text.
 * Returns undefined for anything the platform does not accept.
 */
export async function inspectFile(
  bytes: Buffer,
  declared: { mime?: string | null; filename: string },
): Promise<InspectedFile | undefined> {
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const detected = await fileTypeFromBuffer(bytes);
  if (detected) {
    const format = fileFormatFromMime(detected.mime);
    return format ? { format, mime: detected.mime, sha256 } : undefined;
  }
  const declaredFormat =
    (declared.mime ? fileFormatFromMime(declared.mime) : undefined) ??
    fileFormatFromFilename(declared.filename);
  if (
    declaredFormat &&
    TEXT_FORMATS.includes(declaredFormat) &&
    looksLikeText(bytes)
  ) {
    return {
      format: declaredFormat,
      mime: FILE_FORMAT_MIME_TYPES[declaredFormat][0],
      sha256,
    };
  }
  return undefined;
}
