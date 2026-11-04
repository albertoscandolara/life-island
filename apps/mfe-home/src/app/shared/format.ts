import { UTILITIES, type UtilityKind } from '@life-island/contracts';

const euro = new Intl.NumberFormat('it-IT', {
  style: 'currency',
  currency: 'EUR',
});
const euroRound = new Intl.NumberFormat('it-IT', {
  style: 'currency',
  currency: 'EUR',
  maximumFractionDigits: 0,
});
const compact = new Intl.NumberFormat('en-GB', {
  notation: 'compact',
  maximumFractionDigits: 1,
});
const number = new Intl.NumberFormat('it-IT', { maximumFractionDigits: 1 });
const day = new Intl.DateTimeFormat('en-GB', {
  day: '2-digit',
  month: 'short',
  year: 'numeric',
  timeZone: 'UTC',
});
const monthName = new Intl.DateTimeFormat('en-GB', {
  month: 'short',
  timeZone: 'UTC',
});

export const formatEuro = (value: number): string => euro.format(value);
/** Whole euros, for big figures and axis ticks. */
export const formatEuroRound = (value: number): string =>
  euroRound.format(value);
/** Axis ticks: in full under 10,000, compact above. */
export const formatTick = (value: number, max: number): string =>
  max >= 10_000 ? `€${compact.format(value)}` : euroRound.format(value);
export const formatNumber = (value: number): string => number.format(value);
export const formatDate = (iso: string): string =>
  day.format(new Date(`${iso.slice(0, 10)}T00:00:00Z`));

/** `2026-03` → "Mar 2026", `2026-Q1` → "Q1 2026", `2026` → "2026". */
export function bucketLabel(key: string, short = false): string {
  const month = /^(\d{4})-(\d{2})$/.exec(key);
  if (month) {
    const name = monthName.format(new Date(`${key}-01T00:00:00Z`));
    return short ? name : `${name} ${month[1]}`;
  }
  const quarter = /^(\d{4})-Q(\d)$/.exec(key);
  if (quarter) return `Q${quarter[2]} ${quarter[1]}`;
  return key;
}

export const utilityLabel = (kind: UtilityKind): string =>
  UTILITIES[kind].label;

export const UTILITY_ICONS: Record<UtilityKind, 'bolt' | 'flame' | 'droplet'> =
  {
    ELECTRICITY: 'bolt',
    GAS: 'flame',
    WATER: 'droplet',
  };

/** The chart colour token of a utility. */
export const utilityColor = (kind: UtilityKind): string =>
  `var(--viz-${kind.toLowerCase()})`;

/** The chart colour token of a property's slot; slots past the palette share "other". */
export const propertyColor = (slot: number): string =>
  slot >= 0 && slot < 3
    ? `var(--viz-property-${slot + 1})`
    : 'var(--viz-other)';

/** "Via Ponzilovo 3, Verona", or null without an address. */
export const addressOf = (p: {
  address: string | null;
  city: string | null;
}): string | null =>
  [p.address, p.city].filter((part) => !!part).join(', ') || null;
