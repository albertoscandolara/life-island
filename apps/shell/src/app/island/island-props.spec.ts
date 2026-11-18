import { islandLayout, ZONE_FOOTPRINT } from './island-layout';
import { coastline, islandProps, peakScale, seeded } from './island-props';

describe('island scenery', () => {
  it('keeps the coast within a few per cent of a circle', () => {
    for (let a = 0; a < Math.PI * 2; a += 0.01) {
      expect(coastline(a)).toBeGreaterThan(0.93);
      expect(coastline(a)).toBeLessThan(1.07);
    }
  });

  it('places the same scenery on every visit', () => {
    expect(islandProps(islandLayout(16))).toEqual(
      islandProps(islandLayout(16)),
    );
    const a = seeded(3);
    const b = seeded(3);
    expect([a(), a()]).toEqual([b(), b()]);
  });

  it.each([4, 10, 16])(
    'never puts a tree, bush or rock on a zone (%i zones)',
    (count) => {
      const layout = islandLayout(count);
      const zones = layout.angles.map((deg) => {
        const rad = (deg * Math.PI) / 180;
        return {
          x: Math.cos(rad) * layout.ringRadius,
          z: -Math.sin(rad) * layout.ringRadius,
        };
      });
      for (const prop of islandProps(layout).filter((p) => p.on === 'island'))
        for (const zone of zones)
          expect(Math.hypot(prop.x - zone.x, prop.z - zone.z)).toBeGreaterThan(
            ZONE_FOOTPRINT,
          );
    },
  );

  it('keeps boats and clouds behind the island, where they cover nothing', () => {
    for (const prop of islandProps(islandLayout(16)).filter(
      (p) => p.on === 'sky',
    ))
      expect(prop.z).toBeLessThan(0);
  });

  it('grows the peak with the island, but only so far', () => {
    expect(peakScale(islandLayout(4))).toBe(1);
    expect(peakScale(islandLayout(16))).toBeLessThanOrEqual(1.35);
  });
});
