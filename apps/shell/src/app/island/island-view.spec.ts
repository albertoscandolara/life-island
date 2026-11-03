import { toHex } from './island-view';

describe('toHex', () => {
  it('turns computed CSS colours into what three.js reads', () => {
    expect(toHex('rgb(47, 143, 91)')).toBe('#2f8f5b');
    expect(toHex('rgba(255, 255, 255, 0.5)')).toBe('#ffffff');
    expect(toHex('color(srgb 1 0.5 0)')).toBe('#ff8000');
    expect(toHex('nonsense')).toBe('#808080');
  });
});
