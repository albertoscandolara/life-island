import { checkModel } from './model-files.js';

describe('3D model files', () => {
  it('checks that the bytes are the format the name says', () => {
    const glb = Buffer.concat([Buffer.from('glTF', 'latin1'), Buffer.alloc(8)]);
    expect(checkModel('GLB', glb)).toBeNull();
    expect(checkModel('GLB', Buffer.from('nope'))).toMatch(/not a binary glTF/);
    expect(
      checkModel('GLTF', Buffer.from('{"asset":{"version":"2.0"}}')),
    ).toBeNull();
    expect(
      checkModel(
        'GLTF',
        Buffer.from('{"asset":{},"buffers":[{"uri":"car.bin"}]}'),
      ),
    ).toMatch(/separate .bin files/);
    expect(
      checkModel('OBJ', Buffer.from('# car\nv 0 0 0\nv 1 0 0\n')),
    ).toBeNull();
    expect(checkModel('OBJ', Buffer.from('hello'))).toMatch(/no vertices/);
  });
});
