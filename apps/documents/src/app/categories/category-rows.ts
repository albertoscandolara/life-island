import type { CategoryDto } from '@life-island/contracts';
import type { CategoryHierarchy } from '@life-island/contracts/category-tree';
import {
  CATEGORY_DIMENSION_LABELS,
  CATEGORY_DIMENSIONS,
  type CategoryDimension,
} from '@life-island/contracts/constants';

/** One line of a category tree as shown: a dimension heading or a category. */
export type CategoryRow =
  | { kind: 'heading'; key: string; label: string }
  | {
      kind: 'category';
      key: string;
      category: CategoryDto;
      depth: number;
      hasChildren: boolean;
      expanded: boolean;
    };

/** Dimension groups in display order; general categories (no dimension) last. */
export const DIMENSION_GROUPS: {
  key: CategoryDimension | null;
  label: string;
}[] = [
  ...CATEGORY_DIMENSIONS.map((dimension) => ({
    key: dimension,
    label: CATEGORY_DIMENSION_LABELS[dimension],
  })),
  { key: null, label: 'General' },
];

/**
 * The visible lines of the tree: roots grouped by dimension, each followed
 * by its children when expanded. With `match`, only categories that match
 * (and their ancestors, to show where they are) are listed, all expanded.
 */
export function categoryRows(
  tree: CategoryHierarchy<CategoryDto>,
  expanded: ReadonlySet<string>,
  match?: (category: CategoryDto) => boolean,
): CategoryRow[] {
  const visible = match ? visibleIds(tree, match) : null;
  const rows: CategoryRow[] = [];
  const visit = (category: CategoryDto, depth: number) => {
    if (visible && !visible.has(category.id)) return;
    const children = tree.children(category.id);
    const open = !!visible || expanded.has(category.id);
    rows.push({
      kind: 'category',
      key: category.id,
      category,
      depth,
      hasChildren: children.length > 0,
      expanded: open && children.length > 0,
    });
    if (open) for (const child of children) visit(child, depth + 1);
  };
  const groups = DIMENSION_GROUPS.map((group) => ({
    ...group,
    roots: tree.roots.filter(
      (root) =>
        (root.dimension ?? null) === group.key &&
        (!visible || visible.has(root.id)),
    ),
  })).filter((group) => group.roots.length);
  for (const group of groups) {
    // One group needs no heading.
    if (groups.length > 1)
      rows.push({
        kind: 'heading',
        key: `heading:${group.key ?? 'general'}`,
        label: group.label,
      });
    for (const root of group.roots) visit(root, 0);
  }
  return rows;
}

function visibleIds(
  tree: CategoryHierarchy<CategoryDto>,
  match: (category: CategoryDto) => boolean,
): Set<string> {
  const ids = new Set<string>();
  for (const category of tree.categories)
    if (match(category)) {
      ids.add(category.id);
      for (const ancestor of tree.ancestors(category.id)) ids.add(ancestor.id);
    }
  return ids;
}

/** Case-insensitive match on title or id. */
export function textMatch(text: string): (category: CategoryDto) => boolean {
  const needle = text.trim().toLowerCase();
  return (category) =>
    category.title.toLowerCase().includes(needle) ||
    category.id.toLowerCase().includes(needle);
}
