import {
  CategoryHierarchy,
  dimensionConflicts,
  groupByDimension,
  keepOnePerSingleValuedDimension,
  toggleCategory,
  type CategoryNodeLike,
} from './category-tree.js';

const categories: CategoryNodeLike[] = [
  { id: 'BILL', parentId: null, dimension: 'DOCUMENT_TYPE' },
  { id: 'ELECTRICITY_BILL', parentId: 'BILL', dimension: 'DOCUMENT_TYPE' },
  { id: 'GAS_BILL', parentId: 'BILL', dimension: 'DOCUMENT_TYPE' },
  { id: 'WATER_BILL', parentId: 'BILL', dimension: 'DOCUMENT_TYPE' },
  { id: 'INVOICE', parentId: null, dimension: 'DOCUMENT_TYPE' },
  { id: 'TAX', parentId: null, dimension: 'DOCUMENT_TYPE' },
  { id: 'PROPERTY_TAX', parentId: 'TAX', dimension: 'DOCUMENT_TYPE' },
  { id: 'IMU', parentId: 'PROPERTY_TAX', dimension: 'DOCUMENT_TYPE' },
  { id: 'HOME', parentId: null, dimension: 'SUBJECT' },
  { id: 'MEDICAL', parentId: null, dimension: 'SUBJECT' },
  { id: 'TREGNAGO', parentId: null, dimension: 'PROPERTY' },
  { id: 'VIA_DEI_BANDI', parentId: null, dimension: 'PROPERTY' },
  { id: 'ME', parentId: null, dimension: 'PERSON' },
  { id: 'SPOUSE', parentId: null, dimension: 'PERSON' },
  { id: 'ENEL', parentId: null, dimension: 'ISSUER' },
  { id: 'AMAZON', parentId: null, dimension: 'ISSUER' },
  { id: 'PAID', parentId: null, dimension: 'ATTRIBUTE' },
  { id: 'TAX_DEDUCTIBLE', parentId: null, dimension: 'ATTRIBUTE' },
  { id: 'EXPENSE', parentId: null, dimension: null },
];
const tree = new CategoryHierarchy(categories);
const ids = (list: CategoryNodeLike[]) => list.map((category) => category.id);

describe('CategoryHierarchy', () => {
  it('gives a root several children, and finds roots', () => {
    expect(ids(tree.children('BILL'))).toEqual([
      'ELECTRICITY_BILL',
      'GAS_BILL',
      'WATER_BILL',
    ]);
    expect(ids(tree.roots)).toContain('BILL');
    expect(ids(tree.roots)).not.toContain('WATER_BILL');
  });

  it('computes ancestors from the root and descendants at any depth', () => {
    expect(ids(tree.ancestors('IMU'))).toEqual(['TAX', 'PROPERTY_TAX']);
    expect(ids(tree.ancestors('BILL'))).toEqual([]);
    expect(ids(tree.descendants('TAX'))).toEqual(['PROPERTY_TAX', 'IMU']);
    expect(ids(tree.descendants('IMU'))).toEqual([]);
    expect(tree.root('IMU')?.id).toBe('TAX');
  });

  it('expands a filter to the subtree, never upwards or sideways', () => {
    expect(tree.subtreeIds(['BILL']).sort()).toEqual(
      ['BILL', 'ELECTRICITY_BILL', 'GAS_BILL', 'WATER_BILL'].sort(),
    );
    expect(tree.subtreeIds(['ELECTRICITY_BILL'])).toEqual(['ELECTRICITY_BILL']);
    expect(tree.subtreeIds(['TAX', 'HOME']).sort()).toEqual(
      ['HOME', 'IMU', 'PROPERTY_TAX', 'TAX'].sort(),
    );
  });

  it('rejects moves that would create a cycle and accepts the others', () => {
    expect(tree.moveProblem('BILL', 'BILL')).toMatch(/own parent/);
    expect(tree.moveProblem('TAX', 'IMU')).toMatch(/own descendant/);
    expect(tree.moveProblem('TAX', 'PROPERTY_TAX')).toMatch(/own descendant/);
    expect(tree.moveProblem('BILL', 'MISSING')).toMatch(/does not exist/);
    expect(tree.moveProblem('IMU', 'TAX')).toBeNull();
    expect(tree.moveProblem('IMU', null)).toBeNull();
    expect(tree.moveProblem('WATER_BILL', 'INVOICE')).toBeNull();
  });

  it('never loops on cyclic data and treats a missing parent as the top level', () => {
    const broken = new CategoryHierarchy([
      { id: 'A', parentId: 'B' },
      { id: 'B', parentId: 'A' },
      { id: 'C', parentId: 'GONE' },
    ]);
    expect(ids(broken.ancestors('A'))).toEqual(['B']);
    expect(ids(broken.descendants('A'))).toEqual(['B']);
    expect(ids(broken.roots)).toEqual(['C']);
  });

  it('builds a display tree with depths', () => {
    const tax = tree.tree().find((node) => node.category.id === 'TAX')!;
    expect(tax.depth).toBe(0);
    expect(tax.children[0].category.id).toBe('PROPERTY_TAX');
    expect(tax.children[0].children[0]).toMatchObject({
      depth: 2,
      category: { id: 'IMU' },
    });
  });
});

describe('metadata dimensions', () => {
  it('groups a document by dimension, with nothing mandatory', () => {
    const medical = groupByDimension(['INVOICE', 'MEDICAL', 'ME'], tree);
    expect(medical.DOCUMENT_TYPE).toEqual(['INVOICE']);
    expect(medical.SUBJECT).toEqual(['MEDICAL']);
    expect(medical.PERSON).toEqual(['ME']);
    expect(medical.PROPERTY).toEqual([]);
    expect(medical.ISSUER).toEqual([]);
    expect(groupByDimension(['EXPENSE'], tree).other).toEqual(['EXPENSE']);
  });

  it('allows several subjects, people, properties and attributes', () => {
    expect(
      dimensionConflicts(
        [
          'ELECTRICITY_BILL',
          'HOME',
          'MEDICAL',
          'ME',
          'SPOUSE',
          'TREGNAGO',
          'VIA_DEI_BANDI',
          'PAID',
          'TAX_DEDUCTIBLE',
          'ENEL',
        ],
        tree,
      ),
    ).toEqual([]);
  });

  it('allows one document type and one issuer, a category with its ancestors counting as one', () => {
    expect(dimensionConflicts(['BILL', 'ELECTRICITY_BILL'], tree)).toEqual([]);
    expect(dimensionConflicts(['INVOICE', 'WATER_BILL'], tree)).toEqual([
      { dimension: 'DOCUMENT_TYPE', categoryIds: ['INVOICE', 'WATER_BILL'] },
    ]);
    expect(dimensionConflicts(['GAS_BILL', 'WATER_BILL'], tree)).toHaveLength(
      1,
    );
    expect(dimensionConflicts(['ENEL', 'AMAZON'], tree)).toEqual([
      { dimension: 'ISSUER', categoryIds: ['ENEL', 'AMAZON'] },
    ]);
  });

  it('keeps the first document type and issuer the parser listed', () => {
    expect(
      keepOnePerSingleValuedDimension(
        ['WATER_BILL', 'HOME', 'INVOICE', 'BILL', 'ENEL', 'AMAZON'],
        tree,
      ),
    ).toEqual({
      kept: ['WATER_BILL', 'HOME', 'BILL', 'ENEL'],
      dropped: ['INVOICE', 'AMAZON'],
    });
  });

  it('replaces an unrelated document type when you pick another, and adds freely elsewhere', () => {
    expect(
      toggleCategory(['BILL', 'INVOICE', 'HOME'], 'WATER_BILL', true, tree),
    ).toEqual(['BILL', 'HOME', 'WATER_BILL']);
    expect(toggleCategory(['ME'], 'SPOUSE', true, tree)).toEqual([
      'ME',
      'SPOUSE',
    ]);
    expect(toggleCategory(['ME', 'SPOUSE'], 'ME', false, tree)).toEqual([
      'SPOUSE',
    ]);
  });
});
