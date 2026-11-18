import type { Material, Object3D } from 'three';
import { Mesh } from 'three';

/**
 * A kit made in Blender (tools/scene-models): its models by name, each a
 * top-level object of the glTF whose origin is where it stands.
 */
export interface SceneKit {
  models: ReadonlyMap<string, Object3D>;
  /** Frees the kit's own materials and geometry. */
  dispose(): void;
}

/**
 * Loads a kit; null when it cannot be had (offline, an old browser, a missing
 * file), so a scene keeps the primitives it drew and always works. The glTF
 * loader comes only when needed.
 */
export async function loadSceneKit(url: string): Promise<SceneKit | null> {
  try {
    const { GLTFLoader } =
      await import('three/examples/jsm/loaders/GLTFLoader.js');
    const gltf = await new GLTFLoader().loadAsync(url);
    const models = new Map<string, Object3D>();
    for (const object of gltf.scene.children) models.set(object.name, object);
    return {
      models,
      dispose: () =>
        gltf.scene.traverse((object) => {
          if (!(object instanceof Mesh)) return;
          object.geometry.dispose();
          for (const material of [object.material].flat()) material.dispose();
        }),
    };
  } catch {
    return null;
  }
}

/**
 * A copy of a kit model whose materials `paint` swaps, by the name each was
 * given in Blender (a palette slot such as `body` or `roof`): return the
 * scene's own material to follow the theme, or null to keep the kit's.
 * It keeps the model's own transform (a joined model may carry the rotation
 * of its first part). Geometry is shared with the kit, so dispose of the
 * kit, not the copy.
 */
export function placeKitModel(
  model: Object3D,
  paint: (name: string) => Material | null,
  shadows = false,
): Object3D {
  const copy = model.clone(true);
  copy.traverse((object) => {
    if (!(object instanceof Mesh)) return;
    object.castShadow = shadows;
    object.receiveShadow = shadows;
    const swap = (material: Material) => paint(material.name) ?? material;
    object.material = Array.isArray(object.material)
      ? object.material.map(swap)
      : swap(object.material);
  });
  return copy;
}

/**
 * Loads a 3D model you uploaded for a house or a car (glTF, GLB or OBJ). An
 * OBJ comes without its .mtl, so `plain` paints it like the drawn models.
 */
export async function loadOwnModel(
  url: string,
  format: string | null | undefined,
  plain: () => Material,
): Promise<Object3D> {
  if (format === 'OBJ') {
    const { OBJLoader } =
      await import('three/examples/jsm/loaders/OBJLoader.js');
    const object = await new OBJLoader().loadAsync(url);
    object.traverse((child) => {
      if (child instanceof Mesh) child.material = plain();
    });
    return object;
  }
  const { GLTFLoader } =
    await import('three/examples/jsm/loaders/GLTFLoader.js');
  return (await new GLTFLoader().loadAsync(url)).scene;
}
