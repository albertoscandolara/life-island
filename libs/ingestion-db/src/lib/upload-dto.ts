import type { UploadDto } from '@life-island/contracts';
import type { UploadRow } from './schema.js';

export function toUploadDto(row: UploadRow): UploadDto {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    originalFilename: row.originalFilename,
    fileFormat: row.fileFormat,
    mimeType: row.detectedMime,
    sizeBytes: row.sizeBytes,
    status: row.status,
    categories: row.categories,
    targetKey: row.targetKey,
    details: row.details ?? null,
    lastError: row.lastError,
    createdAt: row.createdAt.toISOString(),
    uploadedAt: row.uploadedAt?.toISOString() ?? null,
    parsedAt: row.parsedAt?.toISOString() ?? null,
  };
}
