import type { ModelFormat } from '@life-island/contracts';

/** What a 3D model of each format is served as. */
export const MODEL_CONTENT_TYPES: Record<ModelFormat, string> = {
  GLB: 'model/gltf-binary',
  GLTF: 'model/gltf+json',
  OBJ: 'model/obj',
};

/**
 * Checks that the bytes look like the format the name says: a GLB starts
 * with "glTF", a glTF is JSON with an `asset`, an OBJ is text with vertices.
 * A glTF must embed its buffers, since only one file is kept.
 */
export function checkModel(format: ModelFormat, bytes: Buffer): string | null {
  if (format === 'GLB')
    return bytes.subarray(0, 4).toString('latin1') === 'glTF'
      ? null
      : 'This is not a binary glTF (.glb) file';
  const text = bytes.toString('utf8');
  if (format === 'GLTF') {
    let json: { asset?: unknown; buffers?: { uri?: string }[] };
    try {
      json = JSON.parse(text) as typeof json;
    } catch {
      return 'This is not a glTF (.gltf) file: it is not JSON';
    }
    if (!json.asset) return 'This is not a glTF (.gltf) file';
    const external = (json.buffers ?? []).some(
      (buffer) => buffer.uri && !buffer.uri.startsWith('data:'),
    );
    return external
      ? 'This glTF points to separate .bin files: export it as a single .glb, or as .gltf with embedded buffers'
      : null;
  }
  return /^\s*v\s+-?[\d.]/m.test(text.slice(0, 1_000_000))
    ? null
    : 'This is not an OBJ file: no vertices found';
}
