/*
 * Where the island's scenery goes: the shape of its coast, and the trees,
 * bushes, rocks and flowers between the zones, the umbrellas on the beach,
 * the boats at sea and the clouds above. Pure and seeded, so the island looks
 * the same on every visit and the placement can be tested.
 */
import {
  PEAK_RADIUS,
  ZONE_FOOTPRINT,
  ZONE_GAP,
  type IslandLayout,
} from './island-layout';

/** The props of the island kit (tools/island-models), by model name. */
export type IslandPropKind =
  | 'palm'
  | 'tree'
  | 'pine'
  | 'bush'
  | 'rocks'
  | 'flowers'
  | 'umbrella'
  | 'sailboat'
  | 'cloud';

export interface IslandProp {
  kind: IslandPropKind;
  /** On the island's ground plane (turns with it), or above and around it (stays put). */
  on: 'island' | 'sky';
  x: number;
  y: number;
  z: number;
  /** Turn around the vertical axis, in radians. */
  turn: number;
  scale: number;
}

/**
 * How far the coast reaches at an angle (radians), as a factor of the
 * island's radius: a gentle wobble of a few per cent, so the island has bays
 * and headlands instead of a perfect circle. Never below 0.95, so the zones
 * always keep their sand.
 */
export function coastline(angle: number): number {
  return (
    1 +
    0.035 * Math.sin(3 * angle + 0.6) +
    0.02 * Math.sin(5 * angle + 2.1) +
    0.012 * Math.sin(9 * angle + 4)
  );
}

/** A small seeded random number generator (mulberry32). */
export function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const GROUND = 0.53;

/** How much the peak grows with the island, so a big island keeps a real mountain. */
export function peakScale(layout: IslandLayout): number {
  const room = (layout.ringRadius - ZONE_FOOTPRINT - 0.9) / PEAK_RADIUS;
  return Math.max(1, Math.min(layout.scale, room, 1.35));
}

function peakRadius(layout: IslandLayout): number {
  return PEAK_RADIUS * peakScale(layout);
}
/** The top of the sandy shore, round the grass. */
const BEACH = 0.25;

/** Where each prop stands, for an island laid out as `layout`. */
export function islandProps(layout: IslandLayout): IslandProp[] {
  const random = seeded(11);
  const props: IslandProp[] = [];
  const at = (angleDeg: number, radius: number) => {
    const rad = (angleDeg * Math.PI) / 180;
    return { x: Math.cos(rad) * radius, z: -Math.sin(rad) * radius };
  };
  const add = (
    kind: IslandPropKind,
    angleDeg: number,
    radius: number,
    y: number,
    scale = 1,
    on: IslandProp['on'] = 'island',
  ) =>
    props.push({
      kind,
      on,
      ...at(angleDeg, radius),
      y,
      turn: random() * Math.PI * 2,
      scale: scale * (0.85 + random() * 0.3),
    });

  const angles = layout.angles.length ? layout.angles : [90];
  const step = 360 / angles.length;
  const ring = layout.ringRadius;
  const shore = layout.islandRadius;
  const innerKinds: IslandPropKind[] = ['tree', 'pine', 'bush', 'flowers'];

  angles.forEach((angle, i) => {
    const gap = angle - step / 2;
    // Between two zones, on the rim: a palm, or rocks.
    add(i % 3 === 2 ? 'rocks' : 'palm', gap, shore - 0.15, BEACH);
    // Between two zones, on the ring itself, when they stand far enough apart.
    const chord = 2 * ring * Math.sin((step * Math.PI) / 360);
    if (chord - 2 * ZONE_FOOTPRINT > ZONE_GAP)
      add(i % 2 ? 'bush' : 'flowers', gap, ring, GROUND);
    if (i % 2 === 0)
      add('flowers', angle, ring - ZONE_FOOTPRINT - 0.25, GROUND, 0.8);
  });

  // Inside the ring, round the peak: a little wood of mixed trees, as many
  // as the meadow has room for, never too close to each other.
  const from = peakRadius(layout) + 0.35;
  const to = ring - ZONE_FOOTPRINT - 0.35;
  const room = Math.PI * (to * to - from * from);
  const wanted = Math.max(4, Math.floor(room / 2.4));
  const placed: { x: number; z: number }[] = [];
  for (let tries = 0; placed.length < wanted && tries < wanted * 20; tries++) {
    const angle = random() * 360;
    // Leave the front (the waterfall's pool) open.
    if (Math.abs(((angle - 90 + 540) % 360) - 180) < 25) continue;
    const radius = Math.sqrt(from * from + random() * (to * to - from * from));
    const spot = at(angle, radius);
    if (placed.some((p) => Math.hypot(p.x - spot.x, p.z - spot.z) < 0.75))
      continue;
    placed.push(spot);
    add(innerKinds[placed.length % innerKinds.length], angle, radius, GROUND);
  }

  // On the beach: two umbrellas and a few rocks, between zones at the back.
  add('umbrella', angles[0] - step * 1.5, shore - 0.12, BEACH, 0.8);
  add('umbrella', angles[0] + step * 2.5, shore - 0.12, BEACH, 0.8);
  for (let i = 0; i < 4; i++) add('rocks', i * 90 + 30, shore + 0.9, -0.2, 1.2);

  // At sea and in the sky; they do not turn with the island.
  // Angles between 0 and 180 are behind the island, seen from the camera,
  // so nothing out there ever covers a zone.
  add('sailboat', 25, shore + 1.9, -0.22, 1.4, 'sky');
  add('sailboat', 150, shore + 2.4, -0.22, 1.5, 'sky');
  // Low and close enough to stay in the clear middle of the frame.
  add('cloud', 105, shore + 2.2, 3.4, 1.5, 'sky');
  add('cloud', 40, shore + 2.8, 2.9, 1.1, 'sky');
  add('cloud', 160, shore + 2.6, 3.1, 1.3, 'sky');
  return props;
}
