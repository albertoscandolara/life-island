import {
  gapBetweenNeighbours,
  islandFov,
  islandLayout,
  visibleLabels,
  MIN_RING_RADIUS,
  PEAK_RADIUS,
  ZONE_FOOTPRINT,
  ZONE_GAP,
} from './island-layout';

describe('islandLayout', () => {
  it('spaces the zones evenly, starting from the one facing you', () => {
    expect(islandLayout(4).angles).toEqual([90, 0, 270, 180]);
    expect(islandLayout(1).angles).toEqual([90]);
    expect(islandLayout(0).angles).toEqual([]);
  });

  it('never leaves a hole: removing an area spreads the others again', () => {
    const angles = islandLayout(7).angles;
    const steps = angles.map(
      (angle, i) => (angle - angles[(i + 1) % angles.length] + 360) % 360,
    );
    for (const step of steps) expect(step).toBeCloseTo(360 / 7);
  });

  it('keeps at least the minimum gap between neighbours, however many', () => {
    for (let count = 2; count <= 40; count++) {
      const layout = islandLayout(count);
      expect(gapBetweenNeighbours(layout)).toBeGreaterThanOrEqual(
        ZONE_GAP - 1e-9,
      );
      // ...and from the peak in the middle.
      expect(
        layout.ringRadius - ZONE_FOOTPRINT - PEAK_RADIUS,
      ).toBeGreaterThanOrEqual(ZONE_GAP - 1e-9);
    }
  });

  it('grows the island only when the zones need the room', () => {
    expect(islandLayout(5).ringRadius).toBe(MIN_RING_RADIUS);
    expect(islandLayout(5).scale).toBe(1);
    const small = islandLayout(10);
    const big = islandLayout(20);
    expect(big.islandRadius).toBeGreaterThan(small.islandRadius);
    expect(big.scale).toBeGreaterThan(1);
    // The zones always stand on the island, with sand left before the shore.
    expect(big.islandRadius).toBeGreaterThan(big.ringRadius + ZONE_FOOTPRINT);
  });
});

describe('visibleLabels', () => {
  const label = (id: string, x: number, facing: number, y = 100) => ({
    id,
    x,
    y,
    width: 100,
    height: 30,
    facing,
  });

  it('keeps the front label when two overlap', () => {
    const shown = visibleLabels(
      [label('back', 50, 0.6), label('front', 90, 0.9), label('far', 400, 0.8)],
      null,
    );
    expect([...shown].sort()).toEqual(['far', 'front']);
  });

  it('hides labels of zones turned away, unless you are on them', () => {
    expect(visibleLabels([label('behind', 0, 0.1)], null).size).toBe(0);
    expect(
      visibleLabels([label('behind', 0, 0.1)], 'behind').has('behind'),
    ).toBe(true);
  });

  it('always shows the hovered label, pushing out the one it covers', () => {
    const shown = visibleLabels(
      [label('front', 0, 1), label('hovered', 20, 0.5)],
      'hovered',
    );
    expect([...shown]).toEqual(['hovered']);
  });
});

describe('islandFov', () => {
  it('keeps the usual view on wide screens', () => {
    expect(islandFov(16 / 9)).toBe(40);
    expect(islandFov(2.4)).toBe(40);
  });

  it('widens as the canvas narrows, so the island stays in view across', () => {
    expect(islandFov(1.2)).toBeGreaterThan(40);
    expect(islandFov(1)).toBeGreaterThan(islandFov(1.2));
  });

  it('never stretches the island on tall phones', () => {
    expect(islandFov(0.5)).toBe(70);
  });
});
