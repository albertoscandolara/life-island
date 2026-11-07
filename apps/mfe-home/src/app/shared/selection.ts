import type { PropertyDto } from '@life-island/contracts';

/**
 * The houses you look at, from the URL: `?houses=<id>,<id>` (none: all of
 * them). The older `?property=<id>` still works, so saved links keep working.
 */
export function selectedIds(
  houses: string | undefined | null,
  property?: string | null,
): string[] {
  const ids = (houses ?? property ?? '')
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean);
  return [...new Set(ids)];
}

/** The selected houses that exist, in your order; every house when none is selected. */
export function scopeHouses(
  all: readonly PropertyDto[],
  ids: readonly string[],
): PropertyDto[] {
  const picked = all.filter((p) => ids.includes(p.id));
  return picked.length ? picked : [...all];
}

/** The query params that select these houses (and forget the older form). */
export function selectionParams(ids: readonly string[]): {
  houses: string | null;
  property: null;
} {
  return { houses: ids.length ? ids.join(',') : null, property: null };
}
