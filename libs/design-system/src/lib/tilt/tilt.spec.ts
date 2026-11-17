import { tiltFor } from './tilt';

describe('tiltFor', () => {
  const box = { left: 100, top: 50, width: 200, height: 100 };

  it('is zero at the centre', () => {
    expect(tiltFor(box, 200, 100)).toEqual({ x: 0, y: 0 });
  });

  it('runs from -0.5 at the top-left to 0.5 at the bottom-right', () => {
    expect(tiltFor(box, 100, 50)).toEqual({ x: -0.5, y: -0.5 });
    expect(tiltFor(box, 300, 150)).toEqual({ x: 0.5, y: 0.5 });
  });

  it('stays within the box when the pointer is outside it', () => {
    expect(tiltFor(box, 900, -40)).toEqual({ x: 0.5, y: -0.5 });
  });

  it('does not divide by zero on an empty box', () => {
    expect(tiltFor({ left: 0, top: 0, width: 0, height: 0 }, 5, 5)).toEqual({
      x: 0,
      y: 0,
    });
  });
});
