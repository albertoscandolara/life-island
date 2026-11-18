import { barPath, labelEvery, niceRange, niceScale } from './scale';

describe('chart scales', () => {
  it('rounds the top of the axis to a clean number', () => {
    expect(niceScale(437)).toEqual({ max: 600, ticks: [0, 200, 400, 600] });
    expect(niceScale(90)).toEqual({ max: 100, ticks: [0, 25, 50, 75, 100] });
    expect(niceScale(0)).toEqual({ max: 1, ticks: [0, 1] });
  });

  it('thins x labels to fit', () => {
    expect(labelEvery(24, 600, 50)).toBe(2);
    expect(labelEvery(6, 600, 50)).toBe(1);
  });

  it('draws nothing for an empty bar', () => {
    expect(barPath(0, 0, 10, 0)).toBe('');
    expect(barPath(0, 0, 10, 20)).toContain('Q');
  });
});

describe('a range that need not start at zero', () => {
  it('rounds both ends outward', () => {
    expect(niceRange(182, 241)).toEqual({
      min: 180,
      max: 260,
      ticks: [180, 200, 220, 240, 260],
    });
  });

  it('keeps one value in the middle of a window', () => {
    const r = niceRange(80, 80);
    expect(r.min).toBeLessThan(80);
    expect(r.max).toBeGreaterThan(80);
  });

  it('works below zero and with swapped ends', () => {
    expect(niceRange(5, -5)).toEqual({
      min: -5,
      max: 5,
      ticks: [-5, -2.5, 0, 2.5, 5],
    });
  });
});
