import {
  PARSE_STEPS,
  type CategoryDto,
  type CategorySuggestionDto,
  type ParseQueueDto,
  type ParseStep,
  type ProcessingState,
  type UploadDto,
} from '@life-island/contracts';
import type {
  CategoryRow,
  CategorySuggestionRow,
  ParseQueueRow,
  UploadRow,
} from './schema.js';

/**
 * What the review UI shows: the status alone cannot tell a document that has
 * not started from one that already has some steps saved.
 */
export function processingStateOf(
  row: Pick<UploadRow, 'status' | 'completedSteps'>,
): ProcessingState {
  switch (row.status) {
    case 'UPLOADING':
      return 'UPLOADING';
    case 'PARSING':
      return 'PROCESSING';
    case 'PARSED':
      return 'PROCESSED';
    case 'FAILED':
      return 'FAILED';
    case 'PAUSED_QUOTA':
    case 'PAUSED_RATE_LIMIT':
      return row.status;
    case 'TO_BE_PARSED':
      return row.completedSteps.length > 0 ? 'PARTIAL' : 'PENDING';
  }
}

export function remainingStepsOf(completed: readonly string[]): ParseStep[] {
  return PARSE_STEPS.filter((step) => !completed.includes(step));
}

export function toUploadDto(row: UploadRow): UploadDto {
  const waiting =
    row.status === 'TO_BE_PARSED' ||
    row.status === 'PAUSED_QUOTA' ||
    row.status === 'PAUSED_RATE_LIMIT';
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    originalFilename: row.originalFilename,
    fileFormat: row.fileFormat,
    mimeType: row.detectedMime,
    sizeBytes: row.sizeBytes,
    status: row.status,
    processingState: processingStateOf(row),
    categories: row.categories,
    targetKey: row.targetKey,
    details: row.details ?? null,
    analysis: row.analysis ?? null,
    extractedFields: row.extractedFields ?? null,
    completedSteps: PARSE_STEPS.filter((step) =>
      row.completedSteps.includes(step),
    ),
    remainingSteps:
      row.status === 'PARSED' ? [] : remainingStepsOf(row.completedSteps),
    currentStep: row.status === 'PARSED' ? null : (row.currentStep ?? null),
    attempts: row.attempts,
    lastAttemptAt: row.lastAttemptAt?.toISOString() ?? null,
    nextAttemptAt: waiting ? row.nextAttemptAt.toISOString() : null,
    flags: row.flags,
    lastError: row.lastError,
    createdAt: row.createdAt.toISOString(),
    uploadedAt: row.uploadedAt?.toISOString() ?? null,
    parsedAt: row.parsedAt?.toISOString() ?? null,
  };
}

export function toCategoryDto(row: CategoryRow): CategoryDto {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    template: row.templateJson,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function toSuggestionDto(
  row: CategorySuggestionRow,
): CategorySuggestionDto {
  return {
    id: row.id,
    categoryId: row.categoryId,
    title: row.title,
    description: row.description,
    template: row.templateJson,
    reason: row.reason,
    status: row.status,
    uploadIds: row.uploadIds,
    approvedCategoryId: row.approvedCategoryId,
    createdAt: row.createdAt.toISOString(),
    reviewedAt: row.reviewedAt?.toISOString() ?? null,
  };
}

export const PARSE_QUEUE_ID = 'documents';

export function toParseQueueDto(
  row: ParseQueueRow | undefined,
  pendingDocuments: number,
): ParseQueueDto {
  return {
    status: row?.status ?? 'IDLE',
    pauseReason: row?.pauseReason ?? null,
    providerError: row?.providerError ?? null,
    pausedAt: row?.pausedAt?.toISOString() ?? null,
    resumeAt: row?.resumeAt?.toISOString() ?? null,
    resumeAtReliable: row?.resumeAtReliable ?? false,
    runStartedAt: row?.runStartedAt?.toISOString() ?? null,
    runFinishedAt: row?.runFinishedAt?.toISOString() ?? null,
    nextScheduledRunAt: row?.nextScheduledRunAt?.toISOString() ?? null,
    lastRunSummary: row?.lastRunSummary ?? null,
    pendingDocuments,
  };
}
