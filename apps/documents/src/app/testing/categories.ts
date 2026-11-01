import type { CategoryDto } from '@life-island/contracts';

/** A category as the API returns it, for tests. */
export function categoryDto(
  id: string,
  parentId: string | null = null,
  changes: Partial<CategoryDto> = {},
): CategoryDto {
  return {
    id,
    title: id
      .toLowerCase()
      .split('_')
      .map((word) => word[0].toUpperCase() + word.slice(1))
      .join(' '),
    description: `About ${id}`,
    template: { fields: [] },
    parentId,
    dimension: 'DOCUMENT_TYPE',
    documentCount: 0,
    totalDocumentCount: 0,
    createdAt: '2026-11-01T00:00:00.000Z',
    updatedAt: '2026-11-01T00:00:00.000Z',
    ...changes,
  };
}

/** BILL > ELECTRICITY_BILL, GAS_BILL; TAX > PROPERTY_TAX > IMU; MEDICAL (subject); EXPENSE (general). */
export const SAMPLE_CATEGORIES: CategoryDto[] = [
  categoryDto('BILL', null, { documentCount: 1, totalDocumentCount: 3 }),
  categoryDto('ELECTRICITY_BILL', 'BILL', {
    documentCount: 1,
    totalDocumentCount: 1,
  }),
  categoryDto('GAS_BILL', 'BILL', { documentCount: 1, totalDocumentCount: 1 }),
  categoryDto('TAX'),
  categoryDto('PROPERTY_TAX', 'TAX'),
  categoryDto('IMU', 'PROPERTY_TAX'),
  categoryDto('MEDICAL', null, { dimension: 'SUBJECT' }),
  categoryDto('EXPENSE', null, { dimension: null }),
];
