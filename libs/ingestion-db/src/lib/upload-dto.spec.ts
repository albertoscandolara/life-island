import { processingStateOf, toUploadDto } from './upload-dto.js';
import type { UploadRow } from './schema.js';

describe('toUploadDto', () => {
  const row: UploadRow = {
    id: '6f1c0a4e-0000-4000-8000-000000000001',
    title: 'Receipt',
    description: null,
    originalFilename: 'receipt.jpg',
    declaredMime: 'image/jpeg',
    detectedMime: 'image/jpeg',
    fileFormat: 'JPG',
    sizeBytes: 1200,
    sha256: 'a'.repeat(64),
    storageKey: '2026/10/x/receipt.jpg',
    status: 'TO_BE_PARSED',
    attempts: 0,
    nextAttemptAt: new Date('2026-10-01T00:00:00Z'),
    lockedUntil: null,
    lockToken: null,
    lastAttemptAt: null,
    lastError: null,
    categories: [],
    completedSteps: [],
    currentStep: null,
    analysis: null,
    extractedFields: null,
    targetKey: null,
    details: null,
    confidence: null,
    flags: [],
    uploadedAt: new Date('2026-10-01T10:00:00Z'),
    parsedAt: null,
    createdAt: new Date('2026-10-01T09:59:00Z'),
    updatedAt: new Date('2026-10-01T10:00:00Z'),
  };

  it('exposes dates as ISO strings and never leaks storage internals', () => {
    const dto = toUploadDto(row);
    expect(dto).toMatchObject({
      createdAt: '2026-10-01T09:59:00.000Z',
      uploadedAt: '2026-10-01T10:00:00.000Z',
      parsedAt: null,
      details: null,
      mimeType: 'image/jpeg',
      categories: [],
    });
    expect(dto).not.toHaveProperty('storageKey');
    expect(dto).not.toHaveProperty('sha256');
  });

  it('tells a partially processed document from one that has not started', () => {
    expect(processingStateOf(row)).toBe('PENDING');
    const partial = { ...row, completedSteps: ['CLASSIFY' as const] };
    expect(processingStateOf(partial)).toBe('PARTIAL');
    expect(toUploadDto(partial)).toMatchObject({
      processingState: 'PARTIAL',
      completedSteps: ['CLASSIFY'],
      remainingSteps: ['EXTRACT', 'DISCOVER'],
      nextAttemptAt: '2026-10-01T00:00:00.000Z',
    });
    expect(
      processingStateOf({ status: 'PAUSED_QUOTA', completedSteps: [] }),
    ).toBe('PAUSED_QUOTA');
    expect(
      toUploadDto({
        ...row,
        status: 'PARSED',
        completedSteps: ['CLASSIFY', 'EXTRACT', 'DISCOVER'],
      }),
    ).toMatchObject({ processingState: 'PROCESSED', remainingSteps: [] });
  });
});
