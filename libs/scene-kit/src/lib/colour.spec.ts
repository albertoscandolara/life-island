import { luminance, toHex } from './colour';

describe('toHex', () => {
  it('reads every way a browser writes a colour', () => {
    expect(toHex('rgb(47, 143, 91)')).toBe('#2f8f5b');
    expect(toHex('rgba(255, 255, 255, 0.5)')).toBe('#ffffff');
    expect(toHex('color(srgb 1 0.5 0)')).toBe('#ff8000');
    expect(toHex('nonsense')).toBe('#808080');
  });
});

describe('luminance', () => {
  it('tells light from dark', () => {
    expect(luminance('#ffffff')).toBeCloseTo(1);
    expect(luminance('#000000')).toBe(0);
    expect(luminance('#0b0f19')).toBeLessThan(0.35);
  });
});
