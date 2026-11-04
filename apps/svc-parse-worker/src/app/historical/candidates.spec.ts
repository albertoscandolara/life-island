import { candidatesFor } from './reclassification.service.js';

const category = (
  id: string,
  taxonomyVersion: number,
  parentId: string | null = null,
) => ({
  id,
  title: id,
  description: id,
  template: { fields: [] },
  parentId,
  dimension: null,
  taxonomyVersion,
});

// BILL (v1) > WATER_BILL (v2); MEDICAL (v3); TAX (v4); INSURANCE (v5).
const CATEGORIES = [
  category('BILL', 1),
  category('WATER_BILL', 2, 'BILL'),
  category('MEDICAL', 3),
  category('TAX', 4),
  category('INSURANCE', 5),
];

const upload = (
  changes: Partial<Parameters<typeof candidatesFor>[0]> = {},
) => ({
  categories: [] as string[],
  rejectedCategories: [] as string[],
  historicalReviewedVersion: null as number | null,
  classifiedCategoryVersion: null as number | null,
  ...changes,
});

const ids = (list: { id: string }[]) => list.map((c) => c.id);

describe('candidatesFor', () => {
  it('offers only categories confirmed after the document was classified, up to the target', () => {
    expect(
      ids(
        candidatesFor(upload({ classifiedCategoryVersion: 2 }), CATEGORIES, 4),
      ),
    ).toEqual(['MEDICAL', 'TAX']);
  });

  it('starts from the later of the last check and the classification', () => {
    expect(
      ids(
        candidatesFor(
          upload({
            classifiedCategoryVersion: 1,
            historicalReviewedVersion: 3,
          }),
          CATEGORIES,
          5,
        ),
      ),
    ).toEqual(['TAX', 'INSURANCE']);
  });

  it('skips categories it has, their ancestors, pending suggestions and declined ones', () => {
    expect(
      ids(
        candidatesFor(
          upload({ categories: ['WATER_BILL'], rejectedCategories: ['TAX'] }),
          CATEGORIES,
          5,
          new Set(['INSURANCE']),
        ),
      ),
    ).toEqual(['MEDICAL']);
  });

  it('offers nothing to a document already checked against the target', () => {
    expect(
      candidatesFor(upload({ historicalReviewedVersion: 5 }), CATEGORIES, 5),
    ).toEqual([]);
  });
});
