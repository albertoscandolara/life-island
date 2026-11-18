import {
  BoxGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  type Material,
} from 'three';
import { placeKitModel } from './kit';

function kitModel(): Group {
  const body = new MeshStandardMaterial();
  body.name = 'body';
  const chrome = new MeshStandardMaterial();
  chrome.name = 'chrome';
  const model = new Group();
  model.add(new Mesh(new BoxGeometry(), [body, chrome]));
  return model;
}

describe('placeKitModel', () => {
  it('swaps palette slots for the scene’s materials and keeps the rest', () => {
    const paint = new MeshStandardMaterial();
    const copy = placeKitModel(kitModel(), (name) =>
      name === 'body' ? paint : null,
    );
    const mesh = copy.children[0] as Mesh;
    const [first, second] = mesh.material as Material[];
    expect(first).toBe(paint);
    expect(second.name).toBe('chrome');
  });

  it('keeps the transform the model was exported with', () => {
    const model = kitModel();
    model.rotation.x = Math.PI / 2;
    const copy = placeKitModel(model, () => null);
    expect(copy.rotation.x).toBeCloseTo(Math.PI / 2);
  });

  it('casts shadows only when asked', () => {
    const lit = placeKitModel(kitModel(), () => null, true);
    expect((lit.children[0] as Mesh).castShadow).toBe(true);
    const flat = placeKitModel(kitModel(), () => null);
    expect((flat.children[0] as Mesh).castShadow).toBe(false);
  });
});
