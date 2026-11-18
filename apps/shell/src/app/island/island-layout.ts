/*
 * Where each zone sits on the island, from how many there are. Zones stand on
 * one ring around the peak, evenly spaced, in the order of the list you pass
 * (the hub's areas, minus the ones turned off), so adding or removing an area
 * never leaves a hole. Neighbours always keep at least ZONE_GAP between their
 * bases; when the ring needs more room, the island grows instead.
 */

/** The outer radius of a zone's hexagonal base (island-scene.ts). */
export const ZONE_FOOTPRINT = 1.15;
/** The least free space between the bases of two neighbouring zones. */
export const ZONE_GAP = 0.6;
/** The rocky peak in the middle; zones keep ZONE_GAP from it too. */
export const PEAK_RADIUS = 1.3;
/** Sand between the outer edge of the zones and the shore. */
export const SHORE_MARGIN = 0.95;
/** The ring radius of the original island, which never gets smaller. */
export const MIN_RING_RADIUS = 3.55;
/** Where the first zone stands (degrees): facing you when the island opens. */
export const FIRST_ANGLE = 90;

export interface IslandLayout {
  /** Distance of every zone's centre from the middle of the island. */
  ringRadius: number;
  /** Radius of the island's grassy top; the shore and foam follow it. */
  islandRadius: number;
  /** How much bigger than the original island this one is (camera, fog). */
  scale: number;
  /** The angle of each zone (degrees), in the order given. */
  angles: number[];
}

/** The ring radius at which `count` zones keep ZONE_GAP between them. */
export function ringRadiusFor(count: number): number {
  const fromPeak = PEAK_RADIUS + ZONE_GAP + ZONE_FOOTPRINT;
  if (count < 2) return Math.max(MIN_RING_RADIUS, fromPeak);
  // Two neighbours are a chord apart: 2 r sin(pi / n) >= 2 footprint + gap.
  const fromNeighbours =
    (2 * ZONE_FOOTPRINT + ZONE_GAP) / (2 * Math.sin(Math.PI / count));
  return Math.max(MIN_RING_RADIUS, fromPeak, fromNeighbours);
}

export function islandLayout(count: number): IslandLayout {
  const ringRadius = ringRadiusFor(count);
  const islandRadius = ringRadius + ZONE_FOOTPRINT + SHORE_MARGIN;
  const baseIsland = MIN_RING_RADIUS + ZONE_FOOTPRINT + SHORE_MARGIN;
  const step = count ? 360 / count : 0;
  return {
    ringRadius,
    islandRadius,
    scale: islandRadius / baseIsland,
    angles: Array.from(
      { length: count },
      (_, i) => (((FIRST_ANGLE - i * step) % 360) + 360) % 360,
    ),
  };
}

/** The free space between the bases of two neighbouring zones, for tests. */
export function gapBetweenNeighbours(layout: IslandLayout): number {
  const n = layout.angles.length;
  if (n < 2) return Infinity;
  const chord = 2 * layout.ringRadius * Math.sin(Math.PI / n);
  return chord - 2 * ZONE_FOOTPRINT;
}

/** A zone label on screen: its anchor (bottom centre) and its size, in CSS pixels. */
export interface PlacedLabel {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  /** 0 when the zone is behind the island, 1 when it faces you. */
  facing: number;
}

/** Labels on zones turned further away than this hide (until hovered or focused). */
export const LABEL_MIN_FACING = 0.35;
/** The least free space kept between two labels that both show. */
export const LABEL_GAP = 4;

/**
 * Which labels show this frame. Front labels win: they are placed first, and
 * a label that would overlap one already placed, or whose zone faces away,
 * hides. The hovered (or focused) label always shows, so the label you are
 * using never disappears under your pointer.
 */
export function visibleLabels(
  labels: readonly PlacedLabel[],
  pinned: string | null,
): Set<string> {
  const order = [...labels].sort(
    (a, b) =>
      Number(b.id === pinned) - Number(a.id === pinned) || b.facing - a.facing,
  );
  const placed: PlacedLabel[] = [];
  const shown = new Set<string>();
  for (const label of order) {
    const forced = label.id === pinned;
    if (!forced && label.facing < LABEL_MIN_FACING) continue;
    const clash = placed.some(
      (other) =>
        Math.abs(label.x - other.x) * 2 <
          label.width + other.width + LABEL_GAP * 2 &&
        Math.abs(label.y - other.y) * 2 <
          label.height + other.height + LABEL_GAP * 2,
    );
    if (clash && !forced) continue;
    placed.push(label);
    shown.add(label.id);
  }
  return shown;
}
