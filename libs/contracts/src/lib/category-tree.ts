/*
 * The category hierarchy, as plain functions over `{ id, parentId }` lists.
 * No dependencies, so the browser (`@life-island/contracts/category-tree`),
 * the ingestion service and the parse worker all compute ancestors,
 * descendants and conflicts the same way. Every walk tracks what it has seen,
 * so even a cycle in bad data cannot make it loop forever.
 */
import {
  CATEGORY_DIMENSIONS,
  SINGLE_VALUED_DIMENSIONS,
  type CategoryDimension,
} from './constants.js';

export interface CategoryNodeLike {
  id: string;
  parentId: string | null;
  dimension?: CategoryDimension | null;
}

export interface CategoryTreeNode<T extends CategoryNodeLike> {
  category: T;
  depth: number;
  children: CategoryTreeNode<T>[];
}

/** Lookups over a list of categories, built once and reused. */
export class CategoryHierarchy<T extends CategoryNodeLike> {
  private readonly byId = new Map<string, T>();
  private readonly childrenById = new Map<string, T[]>();
  readonly roots: T[] = [];

  constructor(
    readonly categories: readonly T[],
    compare: (a: T, b: T) => number = (a, b) => a.id.localeCompare(b.id),
  ) {
    for (const category of categories) this.byId.set(category.id, category);
    for (const category of [...categories].sort(compare)) {
      const parentId = category.parentId;
      // A parent that is missing from the list makes the category a root.
      if (parentId && parentId !== category.id && this.byId.has(parentId)) {
        const siblings = this.childrenById.get(parentId) ?? [];
        siblings.push(category);
        this.childrenById.set(parentId, siblings);
      } else this.roots.push(category);
    }
  }

  get(id: string): T | undefined {
    return this.byId.get(id);
  }

  has(id: string): boolean {
    return this.byId.has(id);
  }

  /** Direct children, sorted. */
  children(id: string): T[] {
    return this.childrenById.get(id) ?? [];
  }

  /** From the root down to the direct parent; empty for a root. */
  ancestors(id: string): T[] {
    const path: T[] = [];
    const seen = new Set([id]);
    let parentId = this.byId.get(id)?.parentId ?? null;
    while (parentId && !seen.has(parentId)) {
      const parent = this.byId.get(parentId);
      if (!parent) break;
      path.unshift(parent);
      seen.add(parentId);
      parentId = parent.parentId;
    }
    return path;
  }

  /** Every category below this one, depth first, in tree order. */
  descendants(id: string): T[] {
    const result: T[] = [];
    const seen = new Set([id]);
    const visit = (parentId: string) => {
      for (const child of this.children(parentId)) {
        if (seen.has(child.id)) continue;
        seen.add(child.id);
        result.push(child);
        visit(child.id);
      }
    };
    visit(id);
    return result;
  }

  /** The ids a filter on these categories matches: each one and all its descendants. */
  subtreeIds(ids: readonly string[]): string[] {
    const result = new Set<string>();
    for (const id of ids) {
      result.add(id);
      for (const descendant of this.descendants(id)) result.add(descendant.id);
    }
    return [...result];
  }

  /** The root of a category's tree (the category itself for a root). */
  root(id: string): T | undefined {
    return this.ancestors(id)[0] ?? this.byId.get(id);
  }

  /** True when `ancestorId` is `id` itself or above it. */
  isSelfOrAncestor(ancestorId: string, id: string): boolean {
    return (
      ancestorId === id ||
      this.ancestors(id).some((category) => category.id === ancestorId)
    );
  }

  /**
   * Why `id` cannot move under `parentId`, or null when it can. Moving to the
   * top level (`parentId` null) is always allowed.
   */
  moveProblem(id: string, parentId: string | null): string | null {
    if (parentId === null) return null;
    if (parentId === id) return `${id} cannot be its own parent`;
    if (!this.byId.has(parentId))
      return `The parent category ${parentId} does not exist`;
    if (this.isSelfOrAncestor(id, parentId))
      return `${parentId} is below ${id}: a category cannot move under its own descendant`;
    return null;
  }

  /** The tree, for display: every node with its depth and children. */
  tree(): CategoryTreeNode<T>[] {
    const seen = new Set<string>();
    const build = (category: T, depth: number): CategoryTreeNode<T> => {
      seen.add(category.id);
      return {
        category,
        depth,
        children: this.children(category.id)
          .filter((child) => !seen.has(child.id))
          .map((child) => build(child, depth + 1)),
      };
    };
    return this.roots.map((root) => build(root, 0));
  }
}

/** A document's categories grouped by dimension; `other` holds those with none. */
export type CategoriesByDimension = Record<CategoryDimension, string[]> & {
  other: string[];
};

export function groupByDimension(
  categoryIds: readonly string[],
  hierarchy: CategoryHierarchy<CategoryNodeLike>,
): CategoriesByDimension {
  const groups = Object.fromEntries([
    ...CATEGORY_DIMENSIONS.map((dimension) => [dimension, [] as string[]]),
    ['other', [] as string[]],
  ]) as CategoriesByDimension;
  for (const id of categoryIds) {
    const dimension = hierarchy.get(id)?.dimension ?? null;
    groups[dimension ?? 'other'].push(id);
  }
  return groups;
}

export interface DimensionConflict {
  dimension: CategoryDimension;
  /** Unrelated categories of a dimension a document can have only one of. */
  categoryIds: string[];
}

/**
 * The single-valued dimensions (document type, issuer) where these categories
 * name more than one unrelated value. A category together with its ancestors
 * is one value: ELECTRICITY_BILL and BILL do not conflict, INVOICE and
 * RECEIPT do.
 */
export function dimensionConflicts(
  categoryIds: readonly string[],
  hierarchy: CategoryHierarchy<CategoryNodeLike>,
): DimensionConflict[] {
  const groups = groupByDimension(categoryIds, hierarchy);
  const conflicts: DimensionConflict[] = [];
  for (const dimension of SINGLE_VALUED_DIMENSIONS) {
    const ids = groups[dimension];
    const related = (a: string, b: string) =>
      hierarchy.isSelfOrAncestor(a, b) || hierarchy.isSelfOrAncestor(b, a);
    if (ids.some((a, i) => ids.slice(i + 1).some((b) => !related(a, b))))
      conflicts.push({ dimension, categoryIds: ids });
  }
  return conflicts;
}

/**
 * Keeps one value per single-valued dimension: the chain of the first
 * category listed (the most relevant, in the parser's order) and anything on
 * the same ancestor path. Returns what was kept and what was dropped.
 */
export function keepOnePerSingleValuedDimension(
  categoryIds: readonly string[],
  hierarchy: CategoryHierarchy<CategoryNodeLike>,
): { kept: string[]; dropped: string[] } {
  const kept: string[] = [];
  const dropped: string[] = [];
  for (const id of categoryIds) {
    const dimension = hierarchy.get(id)?.dimension ?? null;
    const clash =
      dimension !== null &&
      SINGLE_VALUED_DIMENSIONS.includes(dimension) &&
      kept.some(
        (other) =>
          hierarchy.get(other)?.dimension === dimension &&
          !hierarchy.isSelfOrAncestor(other, id) &&
          !hierarchy.isSelfOrAncestor(id, other),
      );
    (clash ? dropped : kept).push(id);
  }
  return { kept, dropped };
}

/**
 * Selecting a category in a single-valued dimension replaces the unrelated
 * ones of that dimension (keeping its own ancestors and descendants); in any
 * other dimension it is simply added. Unselecting removes only that category.
 */
export function toggleCategory(
  selected: readonly string[],
  id: string,
  checked: boolean,
  hierarchy: CategoryHierarchy<CategoryNodeLike>,
): string[] {
  const others = selected.filter((existing) => existing !== id);
  if (!checked) return others;
  const dimension = hierarchy.get(id)?.dimension ?? null;
  if (dimension === null || !SINGLE_VALUED_DIMENSIONS.includes(dimension))
    return [...others, id];
  return [
    ...others.filter(
      (other) =>
        hierarchy.get(other)?.dimension !== dimension ||
        hierarchy.isSelfOrAncestor(other, id) ||
        hierarchy.isSelfOrAncestor(id, other),
    ),
    id,
  ];
}
