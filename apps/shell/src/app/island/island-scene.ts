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
  WebGLRenderer,
} from 'three';
import type { IslandModule } from '../hub/modules';

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

const ISLAND_RADIUS = 5.4;
const ZONE_RADIUS = 3.9;
/** The zones shrink as the island fills up, so neighbours never overlap. */
const zoneScale = (count: number) => Math.min(1, 9.6 / Math.max(count, 1));
const TOP = 0.55;
const CAMERA_HOME = new Vector3(0, 8.5, 12.5);
const LOOK_AT = new Vector3(0, 0.6, 0);

interface Zone {
  module: IslandModule;
  group: Group;
  hover: number;
  scale: number;
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
    this.camera.position.copy(CAMERA_HOME);
    this.camera.lookAt(LOOK_AT);
    this.scene.add(this.island);
    // Start with the first area (730) facing you.
    this.island.rotation.y = Math.PI;
    this.build();
    this.setPalette(palette);
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
    this.scene.fog = new Fog(new Color(palette.fog), 18, 42);
    const set = (name: keyof IslandPalette, value: string) =>
      this.material(name).color.set(value);
    for (const key of [
      'water',
      'foam',
      'sand',
      'grass',
      'rock',
      'trunk',
      'leaves',
    ] as const)
      set(key, palette[key]);
    for (const zone of this.zones) {
      const color = palette.zones[zone.module.id] ?? palette.planned;
      const material = this.material(`zone:${zone.module.id}`);
      material.color.set(color);
      material.emissive.set(color);
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
    cancelAnimationFrame(this.frame);
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
      const scale = zone.scale * (1 + zone.hover * 0.12);
      zone.group.scale.setScalar(scale);
      zone.group.position.y = TOP + zone.hover * 0.25;
      this.material(`zone:${zone.module.id}`).emissiveIntensity =
        0.08 + zone.hover * 0.35;
    }

    this.renderer.render(this.scene, this.camera);
    this.onFrame(this.labels());
  }

  private labels(): ZoneLabel[] {
    const toCamera = this.camera.position.clone().setY(0).normalize();
    return this.zones.map((zone) => {
      const world = zone.group.getWorldPosition(new Vector3());
      const facing = world.clone().setY(0).normalize().dot(toCamera);
      const anchor = world.clone().setY(world.y + 1.9 * zone.scale);
      anchor.project(this.camera);
      return {
        id: zone.module.id,
        x: ((anchor.x + 1) / 2) * this.width,
        y: ((1 - anchor.y) / 2) * this.height,
        facing: Math.max(0, Math.min(1, (facing + 0.55) / 0.9)),
      };
    });
  }

  private material(name: string): MeshStandardMaterial {
    let material = this.materials.get(name);
    if (!material) {
      material = new MeshStandardMaterial({
        flatShading: true,
        roughness: 0.85,
      });
      this.materials.set(name, material);
    }
    return material;
  }

  private mesh(geometry: BufferGeometry, material: Material | string): Mesh {
    this.geometries.push(geometry);
    return new Mesh(
      geometry,
      typeof material === 'string' ? this.material(material) : material,
    );
  }

  private build(): void {
    this.scene.add(new HemisphereLight(0xffffff, 0x445566, 1.3));
    this.scene.add(new AmbientLight(0xffffff, 0.25));
    const sun = new DirectionalLight(0xffffff, 1.6);
    sun.position.set(6, 12, 8);
    this.scene.add(sun);

    const water = this.mesh(new CylinderGeometry(40, 40, 0.2, 48), 'water');
    water.position.y = -0.35;
    this.scene.add(water);
    const foam = this.mesh(
      new RingGeometry(ISLAND_RADIUS + 0.2, ISLAND_RADIUS + 0.9, 28),
      'foam',
    );
    foam.rotation.x = -Math.PI / 2;
    foam.position.y = -0.22;
    this.island.add(foam);

    const shore = this.mesh(
      new CylinderGeometry(ISLAND_RADIUS, ISLAND_RADIUS + 0.5, 0.6, 14),
      'sand',
    );
    shore.position.y = -0.05;
    this.island.add(shore);
    const plateau = this.mesh(
      new CylinderGeometry(ISLAND_RADIUS - 0.6, ISLAND_RADIUS - 0.2, 0.35, 14),
      'grass',
    );
    plateau.position.y = 0.35;
    this.island.add(plateau);

    const peak = this.mesh(new ConeGeometry(1.3, 2.2, 7), 'rock');
    peak.position.y = 1.55;
    this.island.add(peak);
    const cap = this.mesh(new ConeGeometry(0.55, 0.7, 7), 'foam');
    cap.position.y = 2.4;
    this.island.add(cap);

    for (const angle of [0, 60, 120, 180, 240, 300])
      this.palm(angle + 30, ISLAND_RADIUS - 0.3);
    for (const module of this.modules) this.zone(module);
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
  }

  private zone(module: IslandModule): void {
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

    const rad = (module.angle * Math.PI) / 180;
    group.position.set(
      Math.cos(rad) * ZONE_RADIUS,
      TOP,
      -Math.sin(rad) * ZONE_RADIUS,
    );
    group.rotation.y = rad + Math.PI / 2;
    const scale = zoneScale(this.modules.length);
    group.scale.setScalar(scale);
    this.island.add(group);
    this.zones.push({ module, group, hover: 0, scale });
  }
}
