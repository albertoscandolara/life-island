import { imageTypeOf } from './organization-images.js';

describe('imageTypeOf', () => {
  const bytes = (...parts: (string | number[])[]) =>
    Buffer.concat(
      parts.map((p) =>
        typeof p === 'string' ? Buffer.from(p, 'latin1') : Buffer.from(p),
      ),
    );

  it('reads the type from the first bytes', () => {
    expect(
      imageTypeOf(bytes([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
    ).toBe('image/png');
    expect(imageTypeOf(bytes([0xff, 0xd8, 0xff, 0xe0]))).toBe('image/jpeg');
    expect(imageTypeOf(bytes('GIF89a', [0, 0]))).toBe('image/gif');
    expect(imageTypeOf(bytes('RIFF', [1, 2, 3, 4], 'WEBPVP8 '))).toBe(
      'image/webp',
    );
  });

  it('refuses anything else, SVG and HTML included', () => {
    expect(
      imageTypeOf(bytes('<svg xmlns="http://www.w3.org/2000/svg"/>')),
    ).toBe(null);
    expect(imageTypeOf(bytes('<html><script>alert(1)</script>'))).toBe(null);
    expect(imageTypeOf(bytes('RIFF', [1, 2, 3, 4], 'WAVE'))).toBe(null);
    expect(imageTypeOf(new Uint8Array())).toBe(null);
  });
});
