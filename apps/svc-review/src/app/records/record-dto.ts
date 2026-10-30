import type {
  FileFormat,
  RecordDetailDto,
  RecordDto,
} from '@life-island/contracts';
import type { StagingRecordRow } from '../db/schema.js';

export function toRecordDto(row: StagingRecordRow): RecordDto {
  return {
    id: row.id,
    uploadId: row.uploadId,
    title: row.title,
    description: row.description,
    fileFormat: row.fileFormat as FileFormat | null,
    status: row.status,
    category: row.category,
    targetKey: row.targetKey,
    categories: row.categories,
    suggestedCategories: row.suggestedCategories,
    confidence: row.confidence,
    flags: row.flags,
    uploadedAt: row.uploadedAt.toISOString(),
    parsedAt: row.parsedAt?.toISOString() ?? null,
    confirmedAt: row.confirmedAt?.toISOString() ?? null,
    loadedAt: row.loadedAt?.toISOString() ?? null,
  };
}

export function toRecordDetailDto(row: StagingRecordRow): RecordDetailDto {
  return {
    ...toRecordDto(row),
    details: row.reviewedPayload ?? row.aiPayload ?? null,
    edited: row.reviewedPayload !== null,
    parseError: row.parseError,
    loadError: row.loadError,
  };
}
