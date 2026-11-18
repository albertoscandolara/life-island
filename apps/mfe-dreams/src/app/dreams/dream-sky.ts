import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  effect,
  ElementRef,
  inject,
  input,
  signal,
  viewChild,
} from '@angular/core';
import {
  AdditiveBlending,
  BufferGeometry,
  Color,
  CylinderGeometry,
  Float32BufferAttribute,
  Group,
  HemisphereLight,
  IcosahedronGeometry,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PerspectiveCamera,
  Points,
  PointsMaterial,
  Scene,
  SphereGeometry,
  WebGLRenderer,
  type Material,
} from 'three';
import {
  loadSceneKit,
  placeKitModel,
  type SceneKit,
} from '@life-island/scene-kit';

/** One stone of the path: a step you took, the next one, or one still ahead. */
type StoneKind = 'done' | 'next' | 'ahead';

const MAX_STONES = 9;

/** Where the dreams' Blender stone is (tools/scene-models), next to this code. */
export const DREAMS_KIT_URL = new URL('dreams/dreams-kit.glb', import.meta.url)
  .href;

/**
 * The one 3D element of Dreams (3D rule: it adds meaning): the path to the
 * selected dream, as stepping stones floating up towards a glowing light.
 * Each lit stone is a step you took, the pulsing one is your next step, the
 * faint ones are still ahead. It drifts gently, stops when the page is
 * hidden or you prefer less motion, and is only decoration: the same facts
 * are written next to it.
 */
@Component({
  selector: 'dreams-sky',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<canvas #canvas aria-hidden="true"></canvas>
    <span #probe class="probe"></span>`,
  styles: `
    :host {
      position: absolute;
      inset: 0;
      display: block;
      pointer-events: none;
    }
    canvas {
      display: block;
      width: 100%;
      height: 100%;
      opacity: 0;
      transition: opacity var(--duration-slow) var(--ease-out);
    }
    :host(.ready) canvas {
      opacity: 1;
    }
    .probe {
      position: absolute;
      width: 0;
      height: 0;
      overflow: hidden;
      color: var(--accent);
      background-color: var(--accent-2);
      border-color: var(--text-muted);
    }
  `,
  host: { '[class.ready]': 'ready()' },
})
export class DreamSky {
  /** Steps done. */
  readonly done = input(0);
  /** Whether a next step is chosen. */
  readonly next = input(false);
  /** Changes the light's colour a little per dream, so each feels its own. */
  readonly seed = input('');

  protected readonly ready = signal(false);
  private readonly canvas =
    viewChild.required<ElementRef<HTMLCanvasElement>>('canvas');
  private readonly probe = viewChild.required<ElementRef<HTMLElement>>('probe');
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  private renderer: WebGLRenderer | null = null;
  private scene = new Scene();
  private camera = new PerspectiveCamera(40, 2, 0.1, 100);
  private path = new Group();
  private orb: Mesh | null = null;
  private halo: Mesh | null = null;
  private stars: Points | null = null;
  private frame = 0;
  private started = 0;
  /** The Blender stone, once loaded; until then (or without it) a drawn one. */
  private kit: SceneKit | null = null;
  private readonly owned: (BufferGeometry | Material)[] = [];
  private readonly motion =
    typeof matchMedia === 'function' &&
    !matchMedia('(prefers-reduced-motion: reduce)').matches;

  constructor() {
    afterNextRender(() => this.start());
    effect(() => {
      // Rebuild the stones when the dream or its steps change.
      const done = this.done();
      const next = this.next();
      this.seed();
      if (this.renderer) this.build(done, next);
    });
    inject(DestroyRef).onDestroy(() => this.stop());
  }

  private start(): void {
    try {
      this.renderer = new WebGLRenderer({
        canvas: this.canvas().nativeElement,
        alpha: true,
        antialias: true,
        powerPreference: 'low-power',
      });
    } catch {
      // No WebGL: the sky stays a soft gradient, which says the same.
      return;
    }
    this.renderer.setPixelRatio(Math.min(2, globalThis.devicePixelRatio || 1));
    this.camera.position.set(0, 1.4, 9);
    this.camera.lookAt(0, 1.2, 0);
    this.scene.add(new HemisphereLight(0xffffff, 0x445566, 2.2));
    this.scene.add(this.path);
    this.build(this.done(), this.next());
    this.resize();
    this.observer = new ResizeObserver(() => this.resize());
    this.observer.observe(this.host.nativeElement);
    this.themeObserver = new MutationObserver(() =>
      this.build(this.done(), this.next()),
    );
    this.themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme'],
    });
    document.addEventListener('visibilitychange', this.onVisibility);
    this.started = performance.now();
    this.ready.set(true);
    this.loop();
    void loadSceneKit(DREAMS_KIT_URL).then((kit) => {
      if (!kit) return;
      if (!this.renderer) return kit.dispose();
      this.kit = kit;
      this.build(this.done(), this.next());
    });
  }

  private observer: ResizeObserver | null = null;
  private themeObserver: MutationObserver | null = null;

  private readonly onVisibility = () => {
    cancelAnimationFrame(this.frame);
    if (!document.hidden) this.loop();
  };

  /** Colours from the design tokens, as resolved by the browser. */
  private colours(): { accent: Color; accent2: Color; muted: Color } {
    const style = getComputedStyle(this.probe().nativeElement);
    const read = (value: string, fallback: number) => {
      const match = value.match(/[\d.]+/g);
      if (!match || match.length < 3) return new Color(fallback);
      const [r, g, b] = match.map(Number);
      // color-mix() may resolve to color(srgb 0–1 …) instead of rgb(0–255 …).
      return value.startsWith('color(')
        ? new Color(r, g, b)
        : new Color(r! / 255, g! / 255, b! / 255);
    };
    return {
      accent: read(style.color, 0xe08a7a),
      accent2: read(style.backgroundColor, 0x5aa9e6),
      muted: read(style.borderTopColor, 0x98a3b3),
    };
  }

  private own<T extends BufferGeometry | Material>(item: T): T {
    this.owned.push(item);
    return item;
  }

  private clear(): void {
    this.path.clear();
    if (this.stars) this.scene.remove(this.stars);
    for (const item of this.owned.splice(0)) item.dispose();
  }

  private build(done: number, next: boolean): void {
    if (!this.renderer) return;
    this.clear();
    const { accent, accent2, muted } = this.colours();
    const dark = document.documentElement.dataset['theme'] === 'dark';

    // The stones: what you did, the next one, then a few still ahead.
    const shown = Math.min(done, MAX_STONES - 2);
    const kinds: StoneKind[] = [
      ...Array<StoneKind>(shown).fill('done'),
      ...(next ? ['next' as const] : []),
    ];
    while (kinds.length < Math.max(4, shown + 3) && kinds.length < MAX_STONES)
      kinds.push('ahead');
    const stoneGeometry = this.own(new CylinderGeometry(0.5, 0.36, 0.2, 7));
    const rootGeometry = this.own(new IcosahedronGeometry(0.27, 0));
    const lit = this.own(
      new MeshStandardMaterial({
        color: accent,
        emissive: accent,
        emissiveIntensity: dark ? 0.55 : 0.25,
        roughness: 0.6,
        flatShading: true,
      }),
    );
    const glow = this.own(
      new MeshStandardMaterial({
        color: accent,
        emissive: accent,
        emissiveIntensity: 1.1,
        roughness: 0.4,
        flatShading: true,
      }),
    );
    const faint = this.own(
      new MeshStandardMaterial({
        color: muted,
        transparent: true,
        opacity: dark ? 0.35 : 0.45,
        roughness: 0.9,
        flatShading: true,
      }),
    );
    const count = kinds.length;
    kinds.forEach((kind, i) => {
      const t = count === 1 ? 0 : i / (count - 1);
      const stone = new Group();
      const material = kind === 'done' ? lit : kind === 'next' ? glow : faint;
      const model = this.kit?.models.get('stone');
      if (model) {
        // Turned a little each, so the path is not one stone repeated.
        const turn = new Group();
        turn.rotation.y = i * 1.3;
        turn.add(placeKitModel(model, () => material));
        stone.add(turn);
      } else {
        const top = new Mesh(stoneGeometry, material);
        const root = new Mesh(rootGeometry, material);
        root.position.y = -0.18;
        root.scale.set(1.2, 0.8, 1.2);
        stone.add(top, root);
      }
      // A gentle rising curve from the lower left to the light on the right.
      stone.position.set(
        -4.6 + t * 8.2,
        -0.6 + Math.pow(t, 1.4) * 2.9,
        -t * 2.2,
      );
      const scale = 1 - t * 0.35;
      stone.scale.setScalar(scale);
      stone.userData['scale'] = scale;
      stone.userData['phase'] = i * 0.7;
      stone.userData['baseY'] = stone.position.y;
      stone.userData['kind'] = kind;
      this.path.add(stone);
    });

    // The dream: a soft light at the end of the path.
    const orbColor = accent.clone().lerp(new Color(0xffffff), 0.35);
    this.orb = new Mesh(
      this.own(new SphereGeometry(0.55, 24, 16)),
      this.own(new MeshBasicMaterial({ color: orbColor })),
    );
    this.orb.position.set(4.3, 2.9, -2.8);
    this.halo = new Mesh(
      this.own(new SphereGeometry(1.15, 24, 16)),
      this.own(
        new MeshBasicMaterial({
          color: accent2.clone().lerp(orbColor, 0.5),
          transparent: true,
          opacity: dark ? 0.22 : 0.18,
          blending: AdditiveBlending,
          depthWrite: false,
        }),
      ),
    );
    this.halo.position.copy(this.orb.position);
    this.path.add(this.halo, this.orb);

    // A few stars, not a crowd.
    const positions: number[] = [];
    let s = hash(this.seed());
    const rand = () => (s = (s * 16807) % 2147483647) / 2147483647;
    for (let i = 0; i < 70; i++)
      positions.push((rand() - 0.5) * 18, rand() * 6 - 0.5, -3 - rand() * 6);
    const starGeometry = this.own(new BufferGeometry());
    starGeometry.setAttribute(
      'position',
      new Float32BufferAttribute(positions, 3),
    );
    this.stars = new Points(
      starGeometry,
      this.own(
        new PointsMaterial({
          color: dark ? 0xffffff : accent2,
          size: dark ? 0.05 : 0.045,
          transparent: true,
          opacity: dark ? 0.8 : 0.45,
          depthWrite: false,
        }),
      ),
    );
    this.scene.add(this.stars);
    this.render(performance.now());
  }

  private resize(): void {
    if (!this.renderer) return;
    const { clientWidth: w, clientHeight: h } = this.host.nativeElement;
    if (!w || !h) return;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    // Narrow screens step back, so the whole path stays in view.
    this.camera.position.z = w / h < 1.6 ? 11 : 8;
    this.camera.updateProjectionMatrix();
    this.render(performance.now());
  }

  private loop = (): void => {
    this.render(performance.now());
    if (this.motion && !document.hidden)
      this.frame = requestAnimationFrame(this.loop);
  };

  private render(now: number): void {
    if (!this.renderer) return;
    const t = (now - this.started) / 1000;
    if (this.motion) {
      for (const stone of this.path.children) {
        const base = stone.userData['baseY'] as number | undefined;
        if (base === undefined) continue;
        const phase = stone.userData['phase'] as number;
        stone.position.y = base + Math.sin(t * 0.8 + phase) * 0.07;
        stone.rotation.y = Math.sin(t * 0.3 + phase) * 0.25;
        if (stone.userData['kind'] === 'next')
          stone.scale.setScalar(
            (stone.userData['scale'] as number) *
              (1 + Math.sin(t * 2.2) * 0.06),
          );
      }
      if (this.halo) this.halo.scale.setScalar(1 + Math.sin(t * 1.1) * 0.06);
      if (this.stars) this.stars.rotation.y = Math.sin(t * 0.05) * 0.05;
      this.path.rotation.y = Math.sin(t * 0.12) * 0.04;
    }
    this.renderer.render(this.scene, this.camera);
  }

  private stop(): void {
    cancelAnimationFrame(this.frame);
    document.removeEventListener('visibilitychange', this.onVisibility);
    this.observer?.disconnect();
    this.themeObserver?.disconnect();
    this.clear();
    this.kit?.dispose();
    this.kit = null;
    this.renderer?.dispose();
    this.renderer = null;
  }
}

function hash(text: string): number {
  let h = 7;
  for (const c of text) h = (h * 31 + c.charCodeAt(0)) % 2147483647;
  return h || 7;
}
