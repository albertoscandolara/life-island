import { CategoryHierarchy } from '@life-island/contracts/category-tree';
import { SAMPLE_CATEGORIES } from '../testing/categories';
import { categoryRows, textMatch, type CategoryRow } from './category-rows';

const tree = new CategoryHierarchy(SAMPLE_CATEGORIES, (a, b) =>
  a.title.localeCompare(b.title),
);
const labels = (rows: CategoryRow[]) =>
  rows.map((row) =>
    row.kind === 'heading'
      ? `# ${row.label}`
      : `${'  '.repeat(row.depth)}${row.key}`,
  );

describe('categoryRows', () => {
  it('lists roots by dimension, collapsed', () => {
    expect(labels(categoryRows(tree, new Set()))).toEqual([
      '# Document type',
      'BILL',
      'TAX',
      '# Subject',
      'MEDICAL',
      '# General',
      'EXPENSE',
    ]);
  });

  it('shows the children of expanded categories at their depth', () => {
    expect(
      labels(categoryRows(tree, new Set(['TAX', 'PROPERTY_TAX']))).slice(0, 5),
    ).toEqual(['# Document type', 'BILL', 'TAX', '  PROPERTY_TAX', '    IMU']);
    const bill = categoryRows(tree, new Set(['BILL']))[1];
    expect(bill).toMatchObject({ hasChildren: true, expanded: true });
  });

  it('finds categories by title or id and shows the path to them', () => {
    expect(labels(categoryRows(tree, new Set(), textMatch('imu')))).toEqual([
      'TAX',
      '  PROPERTY_TAX',
      '    IMU',
    ]);
    expect(categoryRows(tree, new Set(), textMatch('nothing'))).toEqual([]);
  });
});
