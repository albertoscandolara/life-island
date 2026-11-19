import { BadRequestException, PayloadTooLargeException } from '@nestjs/common';
import {
  UPLOAD_IMAGE_MAX_BYTES,
  type UploadImageType,
} from '@life-island/contracts';
import type { Readable } from 'node:stream';

/** The file extension each accepted image type is stored with. */
export const IMAGE_EXTENSIONS: Record<UploadImageType, string> = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/webp': '.webp',
  'image/gif': '.gif',
};

/**
 * The image type from the file's first bytes, whatever its name or the
 * browser says: only PNG, JPEG, WebP and GIF, never SVG or HTML.
 */
export function imageTypeOf(bytes: Uint8Array): UploadImageType | null {
  const starts = (...sig: number[]) => sig.every((b, i) => bytes[i] === b);
  const ascii = (from: number, text: string) =>
    [...text].every((c, i) => bytes[from + i] === c.charCodeAt(0));
  if (starts(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a))
    return 'image/png';
  if (starts(0xff, 0xd8, 0xff)) return 'image/jpeg';
  if (ascii(0, 'GIF87a') || ascii(0, 'GIF89a')) return 'image/gif';
  if (ascii(0, 'RIFF') && ascii(8, 'WEBP')) return 'image/webp';
  return null;
}

export interface UploadedImage {
  bytes: Buffer;
  type: UploadImageType;
  /** `.png`, `.jpg`… for its storage key. */
  extension: string;
}

/**
 * Reads an image sent as the request body (application/octet-stream): at
 * most `maxBytes`, not empty, and a real PNG, JPEG, WebP or GIF.
 */
export async function readUploadedImage(
  body: Readable,
  maxBytes = UPLOAD_IMAGE_MAX_BYTES,
): Promise<UploadedImage> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of body) {
    size += (chunk as Buffer).length;
    if (size > maxBytes)
      throw new PayloadTooLargeException(
        `An image can be at most ${maxBytes / 1024 / 1024} MB`,
      );
    chunks.push(Buffer.from(chunk as Buffer));
  }
  const bytes = Buffer.concat(chunks);
  if (!bytes.length) throw new BadRequestException('The file is empty');
  const type = imageTypeOf(bytes);
  if (!type)
    throw new BadRequestException('Upload a PNG, JPEG, WebP or GIF image');
  return { bytes, type, extension: IMAGE_EXTENSIONS[type] };
}
