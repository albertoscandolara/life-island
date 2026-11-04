import {
  AmbientLight,
  BoxGeometry,
  BufferGeometry,
  ConeGeometry,
  CylinderGeometry,
  DirectionalLight,
  Group,
  HemisphereLight,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  PerspectiveCamera,
  Raycaster,
  RingGeometry,
  Scene,
  Vector2,
  Vector3,
  WebGLRenderer,
} from 'three';

/** The colours the scene is painted with, resolved from design-system tokens. */
export interface HousesPalette {
  grass: string;
  sand: string;
  walls: string;
  door: string;
  window: string;
  /** Windows glow in the dark theme. */
  glow: number;
  trunk: string;
  leaves: string;
  ring: string;
  /** Roof of each house, by property id: the property's chart colour. */
  roofs: Record<string, string>;
}

export interface HouseLabel {
  id: string;
  x: number;
  y: number;
}

interface House {
  id: string;
  group: Group;
  ring: Mesh;
  hover: number;
  phase: number;
}

const SPACING = 2.7;

/**
 * Your homes as small low-poly houses on grass tiles, one per property, built
 * from primitives (nothing to download). The roof wears the property's chart
 * colour, so a house and its bars always match. Framework-free: the Angular
 * view owns the canvas, the labels and what a click does.
 */
export class HousesScene {
  private readonly renderer: WebGLRenderer;
  private readonly scene = new Scene();
  private readonly camera = new PerspectiveCamera(32, 1, 0.1, 100);
  private readonly houses: House[] = [];
  private readonly materials = new Map<string, MeshStandardMaterial>();
  private readonly geometries: BufferGeometry[] = [];
  private readonly raycaster = new Raycaster();
  private frame = 0;
  private width = 1;
  private height = 1;
  private hovered: string | null = null;
  private selected: string | null = null;

  /** Called every frame with where each house's label goes, in CSS pixels. */
  onFrame: (labels: HouseLabel[]) => void = () => undefined;

  constructor(
    canvas: HTMLCanvasElement,
    ids: readonly string[],
    palette: HousesPalette,
    private readonly motion: boolean,
  ) {
    this.renderer = new WebGLRenderer({ canvas, antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.scene.add(new HemisphereLight(0xffffff, 0x556677, 1.25));
    this.scene.add(new AmbientLight(0xffffff, 0.3));
    const sun = new DirectionalLight(0xffffff, 1.7);
    sun.position.set(-4, 9, 6);
    this.scene.add(sun);
    ids.forEach((id, i) => this.house(id, i, ids.length));
    this.setPalette(palette);
    this.frameCamera();
  }

  start(): void {
    const loop = (time: number) => {
      this.frame = requestAnimationFrame(loop);
      this.tick(time);
    };
    this.frame = requestAnimationFrame(loop);
  }

  resize(width: number, height: number): void {
    this.width = Math.max(1, width);
    this.height = Math.max(1, height);
    this.renderer.setSize(this.width, this.height, false);
    this.camera.aspect = this.width / this.height;
    this.frameCamera();
    if (!this.motion) this.tick(0);
  }

  setPalette(palette: HousesPalette): void {
    const set = (name: string, color: string) =>
      this.material(name).color.set(color);
    set('grass', palette.grass);
    set('sand', palette.sand);
    set('walls', palette.walls);
    set('door', palette.door);
    set('trunk', palette.trunk);
    set('leaves', palette.leaves);
    set('ring', palette.ring);
    const glass = this.material('window');
    glass.color.set(palette.window);
    glass.emissive.set(palette.window);
    glass.emissiveIntensity = palette.glow;
    this.material('ring').emissive.set(palette.ring);
    this.material('ring').emissiveIntensity = 0.6;
    for (const house of this.houses) {
      const roof = this.material(`roof:${house.id}`);
      roof.color.set(palette.roofs[house.id] ?? palette.sand);
    }
    if (!this.motion) this.tick(0);
  }

  highlight(id: string | null): void {
    this.hovered = id;
    if (!this.motion) this.tick(0);
  }

  select(id: string | null): void {
    this.selected = id;
    if (!this.motion) this.tick(0);
  }

  /** The house under a point of the canvas (CSS pixels from its top-left). */
  pick(x: number, y: number): string | null {
    const pointer = new Vector2(
      (x / this.width) * 2 - 1,
      -(y / this.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(pointer, this.camera);
    const hit = this.raycaster.intersectObjects(
      this.houses.map((h) => h.group),
      true,
    )[0];
    let object: Object3D | null = hit?.object ?? null;
    while (object && !object.userData['house']) object = object.parent;
    return (object?.userData['house'] as string | undefined) ?? null;
  }

  dispose(): void {
    cancelAnimationFrame(this.frame);
    this.geometries.forEach((g) => g.dispose());
    this.materials.forEach((m) => m.dispose());
    this.renderer.dispose();
  }

  /** Pulls the camera back until every house fits, whatever the aspect ratio. */
  private frameCamera(): void {
    const span = Math.max(1, this.houses.length) * SPACING;
    const fitWidth =
      span /
      2 /
      Math.tan(((this.camera.fov / 2) * Math.PI) / 180) /
      this.camera.aspect;
    const distance = Math.max(7, fitWidth * 1.05 + 2);
    this.camera.position.set(0, distance * 0.55, distance);
    this.camera.lookAt(new Vector3(0, 0.55, 0));
    this.camera.updateProjectionMatrix();
  }

  private tick(time: number): void {
    const seconds = time / 1000;
    for (const house of this.houses) {
      const on =
        house.id === this.hovered || house.id === this.selected ? 1 : 0;
      house.hover += (on - house.hover) * (this.motion ? 0.12 : 1);
      const dimmed = this.selected && house.id !== this.selected ? 0.9 : 1;
      house.group.scale.setScalar(dimmed + house.hover * 0.1);
      const bob = this.motion
        ? Math.sin(seconds * 1.1 + house.phase) * 0.06
        : 0;
      house.group.position.y = bob + house.hover * 0.3;
      house.group.rotation.y = this.motion
        ? Math.sin(seconds * 0.35 + house.phase) * 0.35 + house.hover * 0.2
        : -0.35;
      house.ring.visible = house.id === this.selected;
      house.ring.rotation.z = seconds * 0.6;
    }
    this.renderer.render(this.scene, this.camera);
    this.onFrame(this.labels());
  }

  private labels(): HouseLabel[] {
    return this.houses.map((house) => {
      const anchor = house.group
        .getWorldPosition(new Vector3())
        .setY(house.group.position.y + 2.15);
      anchor.project(this.camera);
      return {
        id: house.id,
        x: ((anchor.x + 1) / 2) * this.width,
        y: ((1 - anchor.y) / 2) * this.height,
      };
    });
  }

  private material(name: string): MeshStandardMaterial {
    let material = this.materials.get(name);
    if (!material) {
      material = new MeshStandardMaterial({
        flatShading: true,
        roughness: 0.8,
      });
      this.materials.set(name, material);
    }
    return material;
  }

  private mesh(geometry: BufferGeometry, material: string): Mesh {
    this.geometries.push(geometry);
    return new Mesh(geometry, this.material(material));
  }

  private house(id: string, index: number, count: number): void {
    const group = new Group();
    group.userData['house'] = id;
    const add = (mesh: Mesh, x: number, y: number, z: number) => {
      mesh.position.set(x, y, z);
      group.add(mesh);
      return mesh;
    };

    // Ground: a sandy hex with grass on top.
    add(
      this.mesh(new CylinderGeometry(1.2, 1.3, 0.22, 6), 'sand'),
      0,
      -0.11,
      0,
    );
    add(
      this.mesh(new CylinderGeometry(1.12, 1.12, 0.08, 6), 'grass'),
      0,
      0.04,
      0,
    );

    // The house: walls, a pitched roof (a triangular prism), a chimney.
    add(this.mesh(new BoxGeometry(1.1, 0.72, 0.85), 'walls'), 0, 0.44, 0);
    const roof = add(
      this.mesh(new CylinderGeometry(0.62, 0.62, 1.28, 3), `roof:${id}`),
      0,
      1.0,
      0,
    );
    roof.rotation.z = Math.PI / 2;
    roof.rotation.x = -Math.PI / 2;
    roof.scale.set(1, 1, 0.72);
    add(
      this.mesh(new BoxGeometry(0.16, 0.36, 0.16), 'walls'),
      0.32,
      1.22,
      -0.12,
    );

    // A door and two windows facing the camera.
    add(this.mesh(new BoxGeometry(0.22, 0.38, 0.04), 'door'), 0, 0.27, 0.44);
    add(
      this.mesh(new BoxGeometry(0.2, 0.18, 0.04), 'window'),
      -0.32,
      0.5,
      0.44,
    );
    add(this.mesh(new BoxGeometry(0.2, 0.18, 0.04), 'window'), 0.32, 0.5, 0.44);

    // A tree beside it.
    add(
      this.mesh(new CylinderGeometry(0.05, 0.07, 0.35, 5), 'trunk'),
      -0.82,
      0.25,
      0.35,
    );
    add(
      this.mesh(new ConeGeometry(0.26, 0.55, 6), 'leaves'),
      -0.82,
      0.68,
      0.35,
    );

    // The ring that marks the home you are looking at.
    const ring = add(
      this.mesh(new RingGeometry(1.32, 1.46, 6), 'ring'),
      0,
      0.02,
      0,
    );
    ring.rotation.x = -Math.PI / 2;
    ring.visible = false;

    group.position.x = (index - (count - 1) / 2) * SPACING;
    this.scene.add(group);
    this.houses.push({ id, group, ring, hover: 0, phase: index * 1.7 });
  }
}
