import {
  AmbientLight,
  Box3,
  BoxGeometry,
  BufferGeometry,
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
export interface GaragePalette {
  asphalt: string;
  line: string;
  glass: string;
  tyre: string;
  hub: string;
  light: string;
  /** Headlights glow in the dark theme. */
  glow: number;
  ring: string;
  /** Body of each car, by vehicle id: its colour, else the accent. */
  bodies: Record<string, string>;
}

export interface CarLabel {
  id: string;
  x: number;
  y: number;
}

interface Car {
  id: string;
  group: Group;
  /** The drawn car, hidden once a model of yours replaces it. */
  drawn: Group;
  model: Object3D | null;
  ring: Mesh;
  hover: number;
  phase: number;
}

const SPACING = 2.7;

/**
 * Your cars as small low-poly cars on round parking tiles, one per vehicle,
 * built from primitives (nothing to download), as Houses draws its homes. The
 * body wears the car's colour. A 3D model you upload takes the drawn car's
 * place. Framework-free: the Angular view owns the canvas, the labels and
 * what a click does.
 */
export class GarageScene {
  private readonly renderer: WebGLRenderer;
  private readonly scene = new Scene();
  private readonly camera = new PerspectiveCamera(32, 1, 0.1, 100);
  private readonly cars: Car[] = [];
  private readonly materials = new Map<string, MeshStandardMaterial>();
  private readonly geometries: BufferGeometry[] = [];
  private readonly raycaster = new Raycaster();
  private frame = 0;
  private width = 1;
  private height = 1;
  private hovered: string | null = null;
  private selected: ReadonlySet<string> = new Set();

  /** Called every frame with where each car's label goes, in CSS pixels. */
  onFrame: (labels: CarLabel[]) => void = () => undefined;

  constructor(
    canvas: HTMLCanvasElement,
    ids: readonly string[],
    palette: GaragePalette,
    private readonly motion: boolean,
  ) {
    this.renderer = new WebGLRenderer({ canvas, antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.scene.add(new HemisphereLight(0xffffff, 0x556677, 1.25));
    this.scene.add(new AmbientLight(0xffffff, 0.3));
    const sun = new DirectionalLight(0xffffff, 1.7);
    sun.position.set(-4, 9, 6);
    this.scene.add(sun);
    ids.forEach((id, i) => this.car(id, i, ids.length));
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

  setPalette(palette: GaragePalette): void {
    const set = (name: string, color: string) =>
      this.material(name).color.set(color);
    set('asphalt', palette.asphalt);
    set('line', palette.line);
    set('glass', palette.glass);
    set('tyre', palette.tyre);
    set('hub', palette.hub);
    set('ring', palette.ring);
    const light = this.material('light');
    light.color.set(palette.light);
    light.emissive.set(palette.light);
    light.emissiveIntensity = palette.glow;
    this.material('ring').emissive.set(palette.ring);
    this.material('ring').emissiveIntensity = 0.6;
    for (const car of this.cars)
      this.material(`body:${car.id}`).color.set(
        palette.bodies[car.id] ?? palette.ring,
      );
    if (!this.motion) this.tick(0);
  }

  highlight(id: string | null): void {
    this.hovered = id;
    if (!this.motion) this.tick(0);
  }

  /** The car you look at; none for all of them. */
  select(ids: readonly string[]): void {
    this.selected = new Set(ids);
    if (!this.motion) this.tick(0);
  }

  /**
   * Puts your own model in place of the drawn car: scaled to stand on the
   * tile, centred on it. Null brings the drawn car back.
   */
  setModel(id: string, model: Object3D | null): void {
    const car = this.cars.find((c) => c.id === id);
    if (!car) return;
    if (car.model) car.group.remove(car.model);
    car.model = null;
    car.drawn.visible = !model;
    if (model) {
      const holder = new Group();
      holder.add(model);
      const box = new Box3().setFromObject(model);
      const size = box.getSize(new Vector3());
      const footprint = Math.max(size.x, size.z, 1e-6);
      const scale = Math.min(1.9 / footprint, 1.3 / Math.max(size.y, 1e-6));
      const centre = box.getCenter(new Vector3());
      model.position.set(-centre.x, -box.min.y, -centre.z);
      holder.scale.setScalar(scale);
      holder.position.y = 0.08;
      car.group.add(holder);
      car.model = holder;
    }
    if (!this.motion) this.tick(0);
  }

  /** A plain material for models that bring none (an OBJ without its MTL). */
  plainMaterial(): MeshStandardMaterial {
    return this.material('hub');
  }

  /** The car under a point of the canvas (CSS pixels from its top-left). */
  pick(x: number, y: number): string | null {
    const pointer = new Vector2(
      (x / this.width) * 2 - 1,
      -(y / this.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(pointer, this.camera);
    const hit = this.raycaster.intersectObjects(
      this.cars.map((c) => c.group),
      true,
    )[0];
    let object: Object3D | null = hit?.object ?? null;
    while (object && !object.userData['car']) object = object.parent;
    return (object?.userData['car'] as string | undefined) ?? null;
  }

  dispose(): void {
    cancelAnimationFrame(this.frame);
    const shared = new Set<unknown>(this.materials.values());
    for (const car of this.cars)
      car.model?.traverse((object) => {
        const mesh = object as Mesh;
        if (!mesh.isMesh) return;
        mesh.geometry.dispose();
        for (const material of [mesh.material].flat())
          if (!shared.has(material)) material.dispose();
      });
    this.geometries.forEach((g) => g.dispose());
    this.materials.forEach((m) => m.dispose());
    this.renderer.dispose();
  }

  /** Pulls the camera back until every car fits, whatever the aspect ratio. */
  private frameCamera(): void {
    const span = Math.max(1, this.cars.length) * SPACING;
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
    for (const car of this.cars) {
      const chosen = this.selected.has(car.id);
      const on = car.id === this.hovered || chosen ? 1 : 0;
      car.hover += (on - car.hover) * (this.motion ? 0.12 : 1);
      const dimmed = this.selected.size && !chosen ? 0.9 : 1;
      car.group.scale.setScalar(dimmed + car.hover * 0.1);
      const bob = this.motion ? Math.sin(seconds * 1.1 + car.phase) * 0.06 : 0;
      car.group.position.y = bob + car.hover * 0.3;
      // A slow turn on the turntable; standing still with reduced motion.
      car.group.rotation.y = this.motion
        ? seconds * 0.25 + car.phase + car.hover * 0.3
        : -0.6;
      car.ring.visible = chosen;
      car.ring.rotation.z = seconds * 0.6;
    }
    this.renderer.render(this.scene, this.camera);
    this.onFrame(this.labels());
  }

  private labels(): CarLabel[] {
    return this.cars.map((car) => {
      const anchor = car.group
        .getWorldPosition(new Vector3())
        .setY(car.group.position.y + 1.6);
      anchor.project(this.camera);
      return {
        id: car.id,
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

  private car(id: string, index: number, count: number): void {
    const group = new Group();
    group.userData['car'] = id;
    const drawn = new Group();
    group.add(drawn);
    const add = (
      mesh: Mesh,
      x: number,
      y: number,
      z: number,
      parent: Group = drawn,
    ) => {
      mesh.position.set(x, y, z);
      parent.add(mesh);
      return mesh;
    };

    // Ground: a round parking spot with a painted line.
    add(
      this.mesh(new CylinderGeometry(1.25, 1.32, 0.18, 24), 'asphalt'),
      0,
      -0.09,
      0,
      group,
    );
    add(
      this.mesh(new BoxGeometry(0.06, 0.02, 1.9), 'line'),
      -1.0,
      0.01,
      0,
      group,
    );

    // The car, its nose to +x: body, cabin, windows, lights, four wheels.
    add(this.mesh(new BoxGeometry(1.6, 0.34, 0.78), `body:${id}`), 0, 0.36, 0);
    add(
      this.mesh(new BoxGeometry(0.86, 0.3, 0.72), `body:${id}`),
      -0.12,
      0.68,
      0,
    );
    add(this.mesh(new BoxGeometry(0.88, 0.2, 0.74), 'glass'), -0.12, 0.7, 0);
    add(this.mesh(new BoxGeometry(0.05, 0.2, 0.6), 'glass'), 0.33, 0.68, 0);
    for (const z of [-0.26, 0.26])
      add(this.mesh(new BoxGeometry(0.04, 0.08, 0.16), 'light'), 0.81, 0.42, z);
    for (const x of [-0.5, 0.5])
      for (const z of [-0.4, 0.4]) {
        const tyre = add(
          this.mesh(new CylinderGeometry(0.2, 0.2, 0.14, 16), 'tyre'),
          x,
          0.2,
          z,
        );
        tyre.rotation.x = Math.PI / 2;
        const hub = add(
          this.mesh(new CylinderGeometry(0.09, 0.09, 0.16, 10), 'hub'),
          x,
          0.2,
          z,
        );
        hub.rotation.x = Math.PI / 2;
      }

    // The ring that marks the car you are looking at.
    const ring = add(
      this.mesh(new RingGeometry(1.36, 1.5, 32), 'ring'),
      0,
      0.02,
      0,
      group,
    );
    ring.rotation.x = -Math.PI / 2;
    ring.visible = false;

    group.position.x = (index - (count - 1) / 2) * SPACING;
    this.scene.add(group);
    this.cars.push({
      id,
      group,
      drawn,
      model: null,
      ring,
      hover: 0,
      phase: index * 1.7,
    });
  }
}
