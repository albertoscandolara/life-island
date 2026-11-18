import {
  AmbientLight,
  BoxGeometry,
  BufferGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DirectionalLight,
  Fog,
  Group,
  HemisphereLight,
  Material,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  PerspectiveCamera,
  Raycaster,
  RingGeometry,
  Scene,
  SphereGeometry,
  Vector2,
  Vector3,
  PCFSoftShadowMap,
  WebGLRenderer,
} from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { IslandModule } from '../hub/modules';
import { islandLayout, type IslandLayout } from './island-layout';
import { coastline, islandProps, peakScale } from './island-props';

/** The models made in Blender (tools/island-models), served by the shell. */
export const ISLAND_KIT_URL = 'island/island-kit.glb';
/** How much larger than modelled the kit's landmarks stand on their plinth. */
const LANDMARK_SCALE = 1.3;
/** The kit's materials repainted from the design system's tokens. */
const PALETTE_SLOTS = [
  'foam',
  'sand',
  'grass',
  'rock',
  'trunk',
  'leaves',
  'water',
  'window',
] as const;

/** The colours the scene is painted with, resolved from the design system's tokens. */
export interface IslandPalette {
  fog: string;
  water: string;
  foam: string;
  sand: string;
  grass: string;
  rock: string;
  trunk: string;
  leaves: string;
  /** Shallow water round the shore. */
  shallow: string;
  /** The kit's walls, sails and clouds: light in both themes. */
  wall: string;
  /** Windows: pale glass by day, lit at night. */
  window: string;
  /** True in the dark theme: windows glow and the light is softer. */
  night: boolean;
  planned: string;
  /** Accent of each live zone, by module id. */
  zones: Record<string, string>;
}

export interface ZoneLabel {
  id: string;
  x: number;
  y: number;
  /** 0 when the zone is behind the island, 1 when it faces you. */
  facing: number;
}

const TOP = 0.55;
const CAMERA_HOME = new Vector3(0, 8.5, 12.5);
const LOOK_AT = new Vector3(0, 0.6, 0);

interface Zone {
  module: IslandModule;
  group: Group;
  hover: number;
}

/**
 * A low-poly island, built from primitives (no models to download): a sandy
 * shore, a grassy plateau, a rocky peak, palms, and one zone per area of life
 * with its own landmark. Framework-free: the Angular view owns the canvas,
 * the labels and the routing.
 */
export class IslandScene {
  private readonly renderer: WebGLRenderer;
  private readonly scene = new Scene();
  private readonly camera = new PerspectiveCamera(40, 1, 0.1, 100);
  private readonly island = new Group();
  private readonly zones: Zone[] = [];
  private readonly materials = new Map<string, MeshStandardMaterial>();
  private readonly raycaster = new Raycaster();
  private readonly geometries: BufferGeometry[] = [];
  private readonly kitMaterials = new Set<Material>();
  private readonly sun = new DirectionalLight(0xffffff, 1.6);
  private readonly sky = new HemisphereLight(0xffffff, 0x445566, 1.3);
  private readonly peak = new Group();
  /** The primitive palms, then the kit's props once it has loaded. */
  private scenery: Object3D[] = [];
  private disposed = false;
  private frame = 0;
  private hovered: string | null = null;
  private flight: {
    from: Vector3;
    to: Vector3;
    look: Vector3;
    start: number;
    done: () => void;
  } | null = null;
  private spin = 0;
  private dragging = false;
  private width = 1;
  private height = 1;
  private look = LOOK_AT.clone();
  /** Where the zones stand and how big the island is, from how many there are. */
  private readonly layout: IslandLayout;
  /** The camera's resting place, pulled back as the island grows. */
  private readonly home: Vector3;

  /** Called every frame with where each zone's label goes, in CSS pixels. */
  onFrame: (labels: ZoneLabel[]) => void = () => undefined;

  constructor(
    canvas: HTMLCanvasElement,
    private readonly modules: readonly IslandModule[],
    palette: IslandPalette,
    private readonly motion: boolean,
  ) {
    this.renderer = new WebGLRenderer({ canvas, antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = PCFSoftShadowMap;
    this.layout = islandLayout(modules.length);
    this.home = CAMERA_HOME.clone().multiplyScalar(this.layout.scale);
    this.camera.far = 100 * this.layout.scale;
    this.camera.position.copy(this.home);
    this.camera.lookAt(LOOK_AT);
    this.scene.add(this.island);
    // Start with the first area (730) facing you.
    this.island.rotation.y = Math.PI;
    this.build();
    this.setPalette(palette);
  }

  /**
   * Swaps the primitive landmarks for the Blender models once the kit has
   * loaded. Until then (or if it never loads) the island keeps its
   * primitives, so it always works.
   */
  async loadKit(url = ISLAND_KIT_URL): Promise<boolean> {
    try {
      const gltf = await new GLTFLoader().loadAsync(url);
      if (this.disposed) return false;
      const models = new Map<string, Object3D>();
      gltf.scene.traverse((object) => {
        if (object instanceof Mesh) {
          const list = Array.isArray(object.material)
            ? object.material
            : [object.material];
          list.forEach((material) => this.kitMaterials.add(material));
        }
        if (object.parent === gltf.scene) models.set(object.name, object);
      });
      this.applyKit(models);
      return true;
    } catch {
      return false;
    }
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
    // Pull back on narrow screens so the whole island fits.
    this.camera.fov = this.camera.aspect < 1 ? 55 : 40;
    this.camera.updateProjectionMatrix();
  }

  setPalette(palette: IslandPalette): void {
    this.sky.intensity = palette.night ? 0.9 : 1.3;
    this.sun.intensity = palette.night ? 1.1 : 1.6;
    this.scene.fog = new Fog(
      new Color(palette.fog),
      18 * this.layout.scale,
      42 * this.layout.scale,
    );
    const set = (name: string, value: string) =>
      this.painted(name).forEach((material) => material.color.set(value));
    for (const key of [
      'water',
      'foam',
      'sand',
      'grass',
      'rock',
      'trunk',
      'leaves',
      'shallow',
      'window',
      'wall',
    ] as const)
      set(key, palette[key]);
    for (const glass of this.painted('window')) {
      glass.emissive.set(palette.window);
      glass.emissiveIntensity = palette.night ? 0.9 : 0.12;
    }
    const shallow = this.material('shallow');
    shallow.transparent = true;
    shallow.opacity = 0.7;
    for (const zone of this.zones) {
      const color = palette.zones[zone.module.id] ?? palette.planned;
      for (const material of this.painted(`zone:${zone.module.id}`)) {
        material.color.set(color);
        material.emissive.set(color);
      }
    }
  }

  /** Highlights a zone (from the 3D view or from its label). */
  highlight(id: string | null): void {
    this.hovered = id;
  }

  /** Turns the island by a drag of `dx` pixels. */
  drag(dx: number): void {
    this.dragging = true;
    this.island.rotation.y += dx * 0.008;
  }

  endDrag(): void {
    this.dragging = false;
  }

  /** The zone under a point of the canvas (CSS pixels from its top-left). */
  pick(x: number, y: number): string | null {
    const pointer = new Vector2(
      (x / this.width) * 2 - 1,
      -(y / this.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(pointer, this.camera);
    const hit = this.raycaster.intersectObjects(
      this.zones.map((zone) => zone.group),
      true,
    )[0];
    let object: Object3D | null = hit?.object ?? null;
    while (object && !object.userData['zone']) object = object.parent;
    return (object?.userData['zone'] as string | undefined) ?? null;
  }

  /** Flies the camera down to a zone; resolves when it lands (at once without motion). */
  flyTo(id: string): Promise<void> {
    const zone = this.zones.find((z) => z.module.id === id);
    if (!zone || !this.motion) return Promise.resolve();
    const target = zone.group.getWorldPosition(new Vector3());
    const outward = target.clone().setY(0).normalize();
    const to = target
      .clone()
      .add(outward.multiplyScalar(3.2))
      .setY(target.y + 2.4);
    return new Promise((done) => {
      this.flight = {
        from: this.camera.position.clone(),
        to,
        look: target,
        start: performance.now(),
        done,
      };
    });
  }

  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.frame);
    this.kitMaterials.forEach((material) => material.dispose());
    this.geometries.forEach((geometry) => geometry.dispose());
    this.materials.forEach((material) => material.dispose());
    this.renderer.dispose();
  }

  private tick(time: number): void {
    const seconds = time / 1000;
    if (this.flight) {
      const t = Math.min(1, (time - this.flight.start) / 900);
      const eased = 1 - Math.pow(1 - t, 3);
      this.camera.position.lerpVectors(this.flight.from, this.flight.to, eased);
      this.look.lerpVectors(LOOK_AT, this.flight.look, eased);
      this.camera.lookAt(this.look);
      if (t === 1) {
        const done = this.flight.done;
        this.flight = null;
        done();
      }
    } else if (this.motion) {
      // A slow drift that pauses while you hover a zone or turn the island.
      const target = this.hovered || this.dragging ? 0 : 0.0016;
      this.spin += (target - this.spin) * 0.05;
      this.island.rotation.y += this.spin;
      this.island.position.y = Math.sin(seconds * 0.8) * 0.05;
    }

    for (const zone of this.zones) {
      const on = zone.module.id === this.hovered ? 1 : 0;
      zone.hover += (on - zone.hover) * (this.motion ? 0.15 : 1);
      const scale = 1 + zone.hover * 0.12;
      zone.group.scale.setScalar(scale);
      zone.group.position.y = TOP + zone.hover * 0.25;
      for (const material of this.painted(`zone:${zone.module.id}`))
        material.emissiveIntensity = 0.08 + zone.hover * 0.35;
    }

    this.renderer.render(this.scene, this.camera);
    this.onFrame(this.labels());
  }

  private labels(): ZoneLabel[] {
    const toCamera = this.camera.position.clone().setY(0).normalize();
    return this.zones.map((zone) => {
      const world = zone.group.getWorldPosition(new Vector3());
      const facing = world.clone().setY(0).normalize().dot(toCamera);
      const anchor = world.clone().setY(world.y + 1.9);
      anchor.project(this.camera);
      return {
        id: zone.module.id,
        x: ((anchor.x + 1) / 2) * this.width,
        y: ((1 - anchor.y) / 2) * this.height,
        facing: Math.max(0, Math.min(1, (facing + 0.55) / 0.9)),
      };
    });
  }

  /**
   * The scene's material called `name`. The primitives are flat-shaded; the
   * kit's models (`smooth:<slot>`) keep the normals they were modelled with.
   * Both are painted from the same palette slot.
   */
  private material(name: string, smooth = false): MeshStandardMaterial {
    let material = this.materials.get(name);
    if (!material) {
      material = new MeshStandardMaterial({
        flatShading: !smooth,
        roughness: 0.85,
      });
      const twin = this.materials.get(
        smooth ? name.replace(/^smooth:/, '') : `smooth:${name}`,
      );
      if (twin) {
        material.color.copy(twin.color);
        material.emissive.copy(twin.emissive);
        material.emissiveIntensity = twin.emissiveIntensity;
      }
      this.materials.set(name, material);
    }
    return material;
  }

  /** Both shadings of a palette slot or zone tint. */
  private painted(name: string): MeshStandardMaterial[] {
    return [this.material(name), this.material(`smooth:${name}`, true)];
  }

  private mesh(geometry: BufferGeometry, material: Material | string): Mesh {
    this.geometries.push(geometry);
    return new Mesh(
      geometry,
      typeof material === 'string' ? this.material(material) : material,
    );
  }

  private build(): void {
    this.scene.add(this.sky);
    this.scene.add(new AmbientLight(0xffffff, 0.25));
    const radius = this.layout.islandRadius;
    this.sun.position.set(6, 12, 8).multiplyScalar(this.layout.scale);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.bias = -0.0005;
    this.sun.shadow.normalBias = 0.02;
    const reach = radius * 1.25;
    Object.assign(this.sun.shadow.camera, {
      left: -reach,
      right: reach,
      top: reach,
      bottom: -reach,
      near: 1,
      far: 40 * this.layout.scale,
    });
    this.scene.add(this.sun);

    const water = this.mesh(new CylinderGeometry(40, 40, 0.2, 48), 'water');
    water.position.y = -0.35;
    water.receiveShadow = true;
    this.scene.add(water);
    const sides = Math.max(48, Math.round(radius * 10));
    // Shallow water and foam follow the coast's bays and headlands.
    const shallow = this.mesh(
      wobble(new RingGeometry(radius, radius + 2.4, sides * 2, 1), 'xy'),
      'shallow',
    );
    shallow.rotation.x = -Math.PI / 2;
    shallow.position.y = -0.24;
    this.island.add(shallow);
    const foam = this.mesh(
      wobble(new RingGeometry(radius + 0.2, radius + 0.75, sides * 2), 'xy'),
      'foam',
    );
    foam.rotation.x = -Math.PI / 2;
    foam.position.y = -0.22;
    this.island.add(foam);

    const shore = this.mesh(
      wobble(new CylinderGeometry(radius, radius + 0.5, 0.6, sides), 'xz'),
      'sand',
    );
    shore.position.y = -0.05;
    shore.receiveShadow = true;
    this.island.add(shore);
    const plateau = this.mesh(
      wobble(
        new CylinderGeometry(radius - 0.6, radius - 0.2, 0.35, sides),
        'xz',
      ),
      'grass',
    );
    plateau.position.y = 0.35;
    plateau.receiveShadow = true;
    this.island.add(plateau);

    // The peak: primitives until the kit's mountain arrives.
    const rock = this.mesh(new ConeGeometry(1.3, 2.2, 7), 'rock');
    rock.position.y = 1.55;
    const cap = this.mesh(new ConeGeometry(0.55, 0.7, 7), 'foam');
    cap.position.y = 2.4;
    this.peak.add(rock, cap);
    this.island.add(this.peak);

    // Palms on the shore, in the gaps between zones (at most eight).
    const angles = this.layout.angles;
    const gaps = angles.length || 6;
    const every = Math.max(1, Math.ceil(gaps / 8));
    for (let i = 0; i < gaps; i += every)
      this.palm((angles[i] ?? i * 60) - 180 / gaps, radius - 0.3);
    this.modules.forEach((module, i) => this.zone(module, angles[i] ?? 0));
  }

  /** Puts the kit's models in place of the primitives (see loadKit). */
  private applyKit(models: Map<string, Object3D>): void {
    const peak = models.get('peak');
    if (peak) {
      this.peak.clear();
      const mountain = this.place(peak);
      mountain.scale.setScalar(peakScale(this.layout));
      // Its waterfall faces the first zone, the one that faces you first.
      mountain.rotation.y = Math.PI;
      this.peak.position.y = 0.5;
      this.peak.add(mountain);
    }
    if (models.has('prop-palm')) {
      this.scenery.forEach((object) => object.removeFromParent());
      this.scenery = [];
      for (const prop of islandProps(this.layout)) {
        const model = models.get(`prop-${prop.kind}`);
        if (!model) continue;
        const object = this.place(model);
        object.position.set(prop.x, prop.y, prop.z);
        object.rotation.y = prop.turn;
        object.scale.setScalar(prop.scale);
        // A cloud's shadow would only smudge the sea.
        if (prop.kind === 'cloud')
          object.traverse((part) => (part.castShadow = false));
        (prop.on === 'island' ? this.island : this.scene).add(object);
        this.scenery.push(object);
      }
    }
    const plinth = models.get('plinth');
    for (const zone of this.zones) {
      const landmark = models.get(`landmark-${zone.module.landmark}`);
      if (!landmark || !plinth) continue;
      zone.group.clear();
      // Both are modelled round the zone group's origin, the plinth's middle.
      // The landmark is a little larger than its plinth's grass, so it reads
      // from the camera's distance; it still stays inside the plinth.
      const model = this.place(landmark, zone.module.id);
      model.scale.setScalar(LANDMARK_SCALE);
      model.position.y = 0.17 * (1 - LANDMARK_SCALE);
      zone.group.add(this.place(plinth, zone.module.id), model);
    }
  }

  /**
   * A copy of a kit model whose palette materials are the scene's own, so
   * they follow the theme, and whose `tint` is the zone's accent.
   */
  private place(model: Object3D, zone?: string): Object3D {
    const copy = model.clone(true);
    copy.traverse((object) => {
      if (!(object instanceof Mesh)) return;
      object.castShadow = true;
      object.receiveShadow = true;
      const swap = (material: Material) => {
        const name = material.name;
        if (name === 'tint')
          return this.material(`smooth:zone:${zone ?? 'none'}`, true);
        // Walls, sails and clouds stay light in both themes (`wall`); the
        // primitives' `foam` turns dark with the night.
        if (name === 'foam') return this.material('smooth:wall', true);
        if ((PALETTE_SLOTS as readonly string[]).includes(name))
          return this.material(`smooth:${name}`, true);
        return material;
      };
      object.material = Array.isArray(object.material)
        ? object.material.map(swap)
        : swap(object.material);
    });
    return copy;
  }

  private palm(angle: number, radius: number): void {
    const palm = new Group();
    const trunk = this.mesh(new CylinderGeometry(0.07, 0.11, 1.1, 5), 'trunk');
    trunk.position.y = 0.55;
    trunk.rotation.z = 0.15;
    palm.add(trunk);
    const leaves = this.mesh(new ConeGeometry(0.6, 0.35, 6), 'leaves');
    leaves.position.set(0.08, 1.15, 0);
    palm.add(leaves);
    const rad = (angle * Math.PI) / 180;
    palm.position.set(Math.cos(rad) * radius, 0.2, -Math.sin(rad) * radius);
    this.island.add(palm);
    this.scenery.push(palm);
  }

  private zone(module: IslandModule, angle: number): void {
    const group = new Group();
    group.userData['zone'] = module.id;
    const tint = `zone:${module.id}`;
    const add = (mesh: Mesh, x: number, y: number, z: number) => {
      mesh.position.set(x, y, z);
      group.add(mesh);
      return mesh;
    };

    // A hexagonal base in the area's colour, then its landmark.
    add(this.mesh(new CylinderGeometry(1.05, 1.15, 0.2, 6), 'sand'), 0, 0, 0);
    add(this.mesh(new CylinderGeometry(0.95, 0.95, 0.08, 6), tint), 0, 0.12, 0);
    switch (module.landmark) {
      case 'vault': {
        add(this.mesh(new BoxGeometry(0.8, 0.7, 0.7), 'foam'), 0, 0.5, 0);
        add(
          this.mesh(new ConeGeometry(0.65, 0.4, 4), tint),
          0,
          1.05,
          0,
        ).rotation.y = Math.PI / 4;
        for (let i = 0; i < 3; i++)
          add(
            this.mesh(new CylinderGeometry(0.16, 0.16, 0.06, 10), tint),
            0.62,
            0.2 + i * 0.07,
            0.4,
          );
        break;
      }
      case 'market': {
        add(this.mesh(new BoxGeometry(0.9, 0.5, 0.6), 'foam'), 0, 0.4, 0);
        add(
          this.mesh(new BoxGeometry(1.05, 0.08, 0.75), tint),
          0,
          0.72,
          0.05,
        ).rotation.x = 0.25;
        break;
      }
      case 'clinic': {
        add(this.mesh(new BoxGeometry(0.8, 0.6, 0.7), 'foam'), 0, 0.45, 0);
        add(this.mesh(new BoxGeometry(0.45, 0.14, 0.14), tint), 0, 0.95, 0);
        add(this.mesh(new BoxGeometry(0.14, 0.45, 0.14), tint), 0, 0.95, 0);
        break;
      }
      case 'office': {
        add(this.mesh(new BoxGeometry(0.5, 1.4, 0.5), 'foam'), -0.15, 0.85, 0);
        add(this.mesh(new BoxGeometry(0.4, 0.8, 0.4), tint), 0.35, 0.55, 0.1);
        break;
      }
      case 'lighthouse': {
        add(
          this.mesh(new CylinderGeometry(0.2, 0.32, 1.2, 8), 'foam'),
          0,
          0.75,
          0,
        );
        add(this.mesh(new SphereGeometry(0.22, 8, 6), tint), 0, 1.45, 0);
        break;
      }
      case 'house': {
        add(this.mesh(new BoxGeometry(0.8, 0.55, 0.65), 'foam'), 0, 0.42, 0);
        const roof = add(
          this.mesh(new CylinderGeometry(0.5, 0.5, 0.95, 3), tint),
          0,
          0.86,
          0,
        );
        roof.rotation.z = Math.PI / 2;
        roof.rotation.x = -Math.PI / 2;
        roof.scale.set(1, 1, 0.7);
        add(
          this.mesh(new BoxGeometry(0.12, 0.3, 0.12), 'foam'),
          0.22,
          1.02,
          -0.1,
        );
        break;
      }
      case 'library': {
        add(this.mesh(new BoxGeometry(0.9, 0.55, 0.55), 'foam'), 0, 0.42, 0);
        for (let i = 0; i < 3; i++)
          add(
            this.mesh(new BoxGeometry(0.16, 0.42, 0.3), tint),
            -0.25 + i * 0.25,
            0.93,
            0,
          ).rotation.z = (i - 1) * 0.12;
        break;
      }
      case 'gate': {
        // A checkpoint arch with an ID card standing in it.
        for (const x of [-0.38, 0.38])
          add(this.mesh(new BoxGeometry(0.16, 0.9, 0.2), 'foam'), x, 0.6, 0);
        add(this.mesh(new BoxGeometry(0.94, 0.16, 0.24), tint), 0, 1.1, 0);
        const card = add(
          this.mesh(new BoxGeometry(0.42, 0.28, 0.04), tint),
          0,
          0.55,
          0,
        );
        card.rotation.y = 0.35;
        break;
      }
      case 'garage': {
        // A small car: body, cabin and four wheels.
        add(this.mesh(new BoxGeometry(0.9, 0.24, 0.5), tint), 0, 0.42, 0);
        add(
          this.mesh(new BoxGeometry(0.5, 0.22, 0.46), 'foam'),
          -0.05,
          0.65,
          0,
        );
        for (const x of [-0.28, 0.28])
          for (const z of [-0.26, 0.26])
            add(
              this.mesh(new CylinderGeometry(0.12, 0.12, 0.08, 12), 'rock'),
              x,
              0.28,
              z,
            ).rotation.x = Math.PI / 2;
        break;
      }
      case 'clock': {
        // The agenda: a small tower with a clock face.
        add(this.mesh(new BoxGeometry(0.5, 1.2, 0.5), 'foam'), 0, 0.75, 0);
        add(
          this.mesh(new ConeGeometry(0.42, 0.4, 4), tint),
          0,
          1.55,
          0,
        ).rotation.y = Math.PI / 4;
        add(
          this.mesh(new CylinderGeometry(0.2, 0.2, 0.06, 16), tint),
          0,
          1.05,
          0.27,
        ).rotation.x = Math.PI / 2;
        break;
      }
      case 'coins': {
        // Money: three stacks of coins.
        const stacks: [number, number][] = [
          [-0.3, 4],
          [0.05, 6],
          [0.38, 3],
        ];
        for (const [x, count] of stacks)
          for (let i = 0; i < count; i++)
            add(
              this.mesh(new CylinderGeometry(0.17, 0.17, 0.08, 12), tint),
              x,
              0.22 + i * 0.09,
              x * 0.4,
            );
        break;
      }
      case 'flag': {
        // Goals: a flag on a summit.
        add(this.mesh(new ConeGeometry(0.55, 0.6, 5), 'rock'), 0, 0.45, 0);
        add(
          this.mesh(new CylinderGeometry(0.03, 0.03, 1.1, 6), 'foam'),
          0,
          1.15,
          0,
        );
        add(this.mesh(new BoxGeometry(0.42, 0.26, 0.03), tint), 0.22, 1.55, 0);
        break;
      }
      case 'antenna': {
        // Subscriptions: a kiosk with a dish on the roof.
        add(this.mesh(new BoxGeometry(0.7, 0.55, 0.6), 'foam'), 0, 0.42, 0);
        add(
          this.mesh(new CylinderGeometry(0.04, 0.04, 0.4, 6), 'rock'),
          0.15,
          0.9,
          0,
        );
        add(
          this.mesh(
            new SphereGeometry(0.25, 10, 6, 0, Math.PI * 2, 0, 1.1),
            tint,
          ),
          0.15,
          1.0,
          0,
        ).rotation.x = -0.8;
        break;
      }
      case 'boat': {
        // Travel: a boat with its sail.
        add(this.mesh(new BoxGeometry(0.95, 0.22, 0.42), tint), 0, 0.35, 0);
        add(
          this.mesh(new CylinderGeometry(0.03, 0.03, 0.9, 6), 'trunk'),
          0,
          0.9,
          0,
        );
        add(
          this.mesh(new ConeGeometry(0.32, 0.7, 3), 'foam'),
          0.12,
          0.95,
          0,
        ).scale.set(1, 1, 0.15);
        break;
      }
      case 'balloon': {
        // Dreams: a hot-air balloon rising from its basket.
        add(this.mesh(new BoxGeometry(0.34, 0.26, 0.34), 'trunk'), 0, 0.36, 0);
        for (const x of [-0.13, 0.13])
          add(
            this.mesh(new CylinderGeometry(0.012, 0.012, 0.42, 4), 'foam'),
            x,
            0.68,
            0,
          );
        add(
          this.mesh(new SphereGeometry(0.42, 14, 10), tint),
          0,
          1.18,
          0,
        ).scale.set(1, 1.12, 1);
        add(
          this.mesh(new ConeGeometry(0.2, 0.22, 10), tint),
          0,
          0.82,
          0,
        ).rotation.x = Math.PI;
        break;
      }
      case 'track': {
        // Fitness: a running track round a field.
        const track = add(
          this.mesh(new RingGeometry(0.45, 0.72, 20), tint),
          0,
          0.2,
          0,
        );
        track.rotation.x = -Math.PI / 2;
        add(this.mesh(new BoxGeometry(0.06, 0.6, 0.06), 'foam'), -0.22, 0.5, 0);
        add(this.mesh(new BoxGeometry(0.06, 0.6, 0.06), 'foam'), 0.22, 0.5, 0);
        add(this.mesh(new BoxGeometry(0.5, 0.05, 0.05), tint), 0, 0.78, 0);
        break;
      }
    }

    const rad = (angle * Math.PI) / 180;
    const ring = this.layout.ringRadius;
    group.position.set(Math.cos(rad) * ring, TOP, -Math.sin(rad) * ring);
    group.rotation.y = rad + Math.PI / 2;
    this.island.add(group);
    this.zones.push({ module, group, hover: 0 });
  }
}

/**
 * Bends a round geometry's outline to the coast (island-props.ts `coastline`):
 * every vertex moves out or in along its own direction from the middle.
 * `plane` is where the circle lies before any rotation: 'xz' for a cylinder,
 * 'xy' for a ring that is laid flat afterwards.
 */
function wobble<T extends BufferGeometry>(geometry: T, plane: 'xz' | 'xy'): T {
  const position = geometry.getAttribute('position');
  for (let i = 0; i < position.count; i++) {
    const x = position.getX(i);
    const other = plane === 'xz' ? -position.getZ(i) : position.getY(i);
    if (Math.hypot(x, other) < 1e-6) continue;
    const factor = coastline(Math.atan2(other, x));
    position.setX(i, x * factor);
    if (plane === 'xz') position.setZ(i, position.getZ(i) * factor);
    else position.setY(i, position.getY(i) * factor);
  }
  position.needsUpdate = true;
  geometry.computeVertexNormals();
  return geometry;
}
