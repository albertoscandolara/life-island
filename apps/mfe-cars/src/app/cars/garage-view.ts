import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  effect,
  ElementRef,
  inject,
  Injector,
  input,
  output,
  signal,
  untracked,
  viewChild,
  viewChildren,
} from '@angular/core';
import type { VehicleDto } from '@life-island/contracts';
import {
  loadOwnModel,
  loadSceneKit,
  toHex,
  type SceneKit,
} from '@life-island/scene-kit';
import { CarsApi } from '../api/cars-api';
import {
  GARAGE_KIT_URL,
  GarageScene,
  type GaragePalette,
} from './garage-scene';
import { carShape, paintColour, vehicleName } from './labels';

/**
 * Your cars in 3D, side by side on their parking spots: the drawn car wears
 * its colour, or your own model takes its place (as for houses). Click a car
 * to look at it. Without WebGL it falls back to plain buttons; with reduced
 * motion it stands still.
 */
@Component({
  selector: 'cars-garage-view',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (!failed()) {
      <canvas
        #canvas
        class="canvas"
        [class.canvas--pointer]="hovered() !== null"
        aria-hidden="true"
        (pointermove)="move($event)"
        (pointerleave)="hover(null)"
        (click)="click($event)"
      ></canvas>
    }
    <ul
      class="labels"
      [class.labels--flat]="failed()"
      role="list"
      aria-label="Your cars in 3D"
    >
      @for (v of vehicles(); track v.id) {
        <li #label class="label-item">
          <button
            type="button"
            class="label"
            [class.label--on]="selectedId() === v.id"
            [attr.aria-pressed]="selectedId() === v.id"
            (pointerenter)="hover(v.id)"
            (pointerleave)="hover(null)"
            (focus)="hover(v.id)"
            (blur)="hover(null)"
            (click)="chosen.emit(v.id)"
          >
            <span class="plate">{{ v.values.registrationNumber ?? '?' }}</span>
            {{ v.label || v.values.commercialName || 'Car' }}
          </button>
        </li>
      }
    </ul>
    <p class="hint">Click a car to look at it</p>
  `,
  styles: `
    :host {
      --garage-asphalt: color-mix(
        in srgb,
        var(--text-muted) 45%,
        var(--surface-card)
      );
      --garage-line: var(--surface-card);
      --garage-glass: color-mix(
        in srgb,
        var(--tone-info) 35%,
        var(--text-primary)
      );
      --garage-tyre: color-mix(in srgb, var(--text-primary) 85%, black);
      --garage-hub: color-mix(
        in srgb,
        var(--surface-card) 80%,
        var(--text-muted)
      );
      --garage-light: var(--tone-warning);
      --garage-ring: var(--accent);

      position: relative;
      display: block;
      min-height: 15rem;
      height: 100%;
      overflow: hidden;
      border: 1px solid var(--border-subtle);
      border-radius: var(--card-radius);
      background:
        radial-gradient(
          circle at 50% 120%,
          color-mix(in srgb, var(--accent) 22%, transparent),
          transparent 65%
        ),
        linear-gradient(180deg, var(--surface-card), var(--surface-sunken));
      box-shadow: var(--shadow-card);
    }
    .canvas {
      position: absolute;
      inset: 0;
      display: block;
      width: 100%;
      height: 100%;
    }
    .canvas--pointer {
      cursor: pointer;
    }
    .labels {
      margin: 0;
      padding: 0;
      list-style: none;
    }
    .label-item {
      position: absolute;
      top: 0;
      left: 0;
      will-change: transform;
    }
    .labels--flat {
      display: flex;
      flex-wrap: wrap;
      gap: var(--space-2);
      padding: var(--space-6);
    }
    .labels--flat .label-item {
      position: static;
      transform: none;
    }
    .label {
      display: inline-flex;
      align-items: center;
      gap: var(--space-2);
      padding: var(--space-1) var(--space-3);
      border: 1px solid var(--border-subtle);
      border-radius: var(--radius-full);
      background: var(--surface-glass);
      backdrop-filter: blur(8px);
      color: var(--text-primary);
      font: inherit;
      font-size: var(--text-sm);
      font-weight: 600;
      white-space: nowrap;
      cursor: pointer;
      box-shadow: var(--shadow-card);
      transition:
        border-color var(--duration-fast) var(--ease-out),
        transform var(--duration-normal) var(--ease-spring);
    }
    .label:hover,
    .label--on {
      border-color: var(--accent);
      transform: scale(1.06);
    }
    .plate {
      padding: 0 var(--space-1);
      border: 1px solid var(--border-strong);
      border-left: var(--space-1) solid var(--tone-info);
      border-radius: var(--radius-sm);
      font-family: var(--font-mono);
      font-size: var(--text-xs);
      letter-spacing: 0.06em;
    }
    .hint {
      position: absolute;
      right: var(--space-3);
      bottom: var(--space-2);
      margin: 0;
      color: var(--text-muted);
      font-size: var(--text-xs);
    }
  `,
})
export class GarageView {
  private readonly api = inject(CarsApi);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly canvas = viewChild<ElementRef<HTMLCanvasElement>>('canvas');
  private readonly labelEls = viewChildren<ElementRef<HTMLElement>>('label');

  readonly vehicles = input.required<VehicleDto[]>();
  /** The car you are looking at. */
  readonly selectedId = input<string | null>(null);
  readonly chosen = output<string>();

  protected readonly hovered = signal<string | null>(null);
  protected readonly failed = signal(false);

  /** What the scene is built from: rebuilt only when a car, its colour or its model changes. */
  private readonly shape = computed(
    () =>
      this.vehicles()
        .map(
          (v) =>
            `${v.id}:${v.values.colour ?? ''}:${v.model?.uploadedAt ?? ''}`,
        )
        .join('|'),
    { equal: (a, b) => a === b },
  );

  private scene: GarageScene | null = null;
  /** The garage's Blender models, loaded once for every rebuild of the scene. */
  private kit: Promise<SceneKit | null> | null = null;
  private readonly injector = inject(Injector);

  constructor() {
    const destroyRef = inject(DestroyRef);
    afterNextRender(() => {
      const build = effect(
        () => {
          this.shape();
          const cars = untracked(() => this.vehicles());
          this.scene?.dispose();
          this.scene = null;
          const canvas = this.canvas()?.nativeElement;
          if (!canvas || !cars.length) return;
          const motion = !matchMedia('(prefers-reduced-motion: reduce)')
            .matches;
          try {
            this.scene = new GarageScene(
              canvas,
              cars.map((v) => v.id),
              this.palette(cars),
              motion,
            );
          } catch {
            this.failed.set(true);
            return;
          }
          const scene = this.scene;
          this.kit ??= loadSceneKit(GARAGE_KIT_URL);
          void this.kit.then((kit) => {
            if (kit && this.scene === scene)
              scene.useKit(
                kit,
                Object.fromEntries(cars.map((v) => [v.id, carShape(v.values)])),
              );
          });
          const selected = untracked(() => this.selectedId());
          scene.select(selected ? [selected] : []);
          for (const car of cars) {
            if (!car.model) continue;
            const url = this.api.modelUrl(car.id, car.model.uploadedAt);
            loadOwnModel(url, car.model.format, () => scene.plainMaterial())
              .then((model) => {
                if (this.scene === scene) scene.setModel(car.id, model);
              })
              .catch((error: unknown) =>
                console.warn(
                  `The 3D model of ${vehicleName(car)} did not load`,
                  error,
                ),
              );
          }
          scene.onFrame = (positions) => {
            const labels = this.labelEls();
            positions.forEach((position, i) => {
              const label = labels[i]?.nativeElement;
              if (label)
                label.style.transform = `translate(-50%, -100%) translate(${position.x}px, ${Math.max(40, position.y)}px)`;
            });
          };
          const { width, height } =
            this.host.nativeElement.getBoundingClientRect();
          scene.resize(width, height);
          if (motion) scene.start();
        },
        { injector: this.injector },
      );
      const resize = new ResizeObserver(([entry]) =>
        this.scene?.resize(entry.contentRect.width, entry.contentRect.height),
      );
      resize.observe(this.host.nativeElement);
      const theme = new MutationObserver(() =>
        this.scene?.setPalette(this.palette(this.vehicles())),
      );
      theme.observe(document.documentElement, {
        attributeFilter: ['data-theme'],
      });
      destroyRef.onDestroy(() => {
        build.destroy();
        resize.disconnect();
        theme.disconnect();
        this.scene?.dispose();
        void this.kit?.then((kit) => kit?.dispose());
      });
    });
    effect(() => {
      const id = this.selectedId();
      this.scene?.select(id ? [id] : []);
    });
  }

  protected hover(id: string | null): void {
    this.hovered.set(id);
    this.scene?.highlight(id);
  }

  protected move(event: PointerEvent): void {
    const { x, y } = this.local(event);
    const id = this.scene?.pick(x, y) ?? null;
    if (id !== this.hovered()) this.hover(id);
  }

  protected click(event: MouseEvent): void {
    const { x, y } = this.local(event);
    const id = this.scene?.pick(x, y);
    if (id) this.chosen.emit(id);
  }

  private local(event: MouseEvent): { x: number; y: number } {
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  /** Resolves the colour tokens above to colours WebGL understands. */
  private palette(cars: VehicleDto[]): GaragePalette {
    const host = this.host.nativeElement;
    const probe = document.createElement('span');
    probe.style.display = 'none';
    host.appendChild(probe);
    const resolve = (value: string) => {
      probe.style.color = value;
      return toHex(getComputedStyle(probe).color);
    };
    const token = (name: string) => resolve(`var(--garage-${name})`);
    const dark = document.documentElement.dataset['theme'] === 'dark';
    const accent = resolve('var(--accent-2)');
    const palette: GaragePalette = {
      asphalt: token('asphalt'),
      line: token('line'),
      glass: token('glass'),
      tyre: token('tyre'),
      hub: token('hub'),
      light: token('light'),
      glow: dark ? 0.9 : 0.15,
      ring: token('ring'),
      bodies: Object.fromEntries(
        cars.map((v) => [v.id, paintColour(v.values.colour) ?? accent]),
      ),
    };
    probe.remove();
    return palette;
  }
}
