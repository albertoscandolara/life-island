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
  signal,
  untracked,
  viewChild,
  viewChildren,
} from '@angular/core';
import { Router } from '@angular/router';
import {
  loadOwnModel,
  loadSceneKit,
  toHex,
  type SceneKit,
} from '@life-island/scene-kit';
import { HomeApi } from '../api/home-api';
import { propertyColor } from '../shared/format';
import { PropertyStore } from '../shared/property-store';
import { selectionParams } from '../shared/selection';
import {
  HOUSES_KIT_URL,
  HousesScene,
  type HousesPalette,
} from './houses-scene';

/**
 * Your homes in 3D: one small house per property, its roof in the property's
 * colour. Click a house to look at that home (again to see them all). Without
 * WebGL it falls back to plain buttons; with reduced motion it stands still.
 */
@Component({
  selector: 'home-houses-view',
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
      aria-label="Your homes"
    >
      @for (p of properties(); track p.id) {
        <li #label class="label-item">
          <button
            type="button"
            class="label"
            [class.label--on]="selected().includes(p.id)"
            [attr.aria-pressed]="selected().includes(p.id)"
            (pointerenter)="hover(p.id)"
            (pointerleave)="hover(null)"
            (focus)="hover(p.id)"
            (blur)="hover(null)"
            (click)="choose(p.id, $event)"
          >
            <span class="dot" [style.background]="color(p.colorSlot)"></span>
            {{ p.name }}
          </button>
        </li>
      }
    </ul>
    <p class="hint">
      {{
        selected().length
          ? 'Click the house again to see every house; Ctrl/⌘-click adds one'
          : 'Click a house to look at it; Ctrl/⌘-click to pick several'
      }}
    </p>
  `,
  styles: `
    :host {
      --houses-grass: color-mix(
        in srgb,
        var(--tone-success) 75%,
        var(--surface-card)
      );
      --houses-sand: color-mix(
        in srgb,
        var(--tone-warning) 35%,
        var(--surface-card)
      );
      --houses-walls: color-mix(
        in srgb,
        var(--surface-card) 88%,
        var(--text-muted)
      );
      --houses-door: color-mix(
        in srgb,
        var(--tone-warning) 55%,
        var(--text-primary)
      );
      --houses-window: color-mix(
        in srgb,
        var(--tone-info) 45%,
        var(--surface-card)
      );
      --houses-trunk: color-mix(
        in srgb,
        var(--tone-warning) 60%,
        var(--text-primary)
      );
      --houses-leaves: var(--tone-success);
      --houses-ring: var(--accent);

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
    :host-context([data-theme='dark']) {
      --houses-window: var(--tone-warning);
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
    .dot {
      width: var(--space-2);
      height: var(--space-2);
      border-radius: var(--radius-full);
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
export class HousesView {
  private readonly store = inject(PropertyStore);
  private readonly api = inject(HomeApi);
  private readonly router = inject(Router);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly canvas = viewChild<ElementRef<HTMLCanvasElement>>('canvas');
  private readonly labelEls = viewChildren<ElementRef<HTMLElement>>('label');

  /** The houses you are looking at; none for every house. */
  readonly selected = input<string[]>([]);
  /** Smaller, for the Bills headline. */
  readonly compact = input(false);

  protected readonly properties = computed(() => this.store.properties() ?? []);
  protected readonly hovered = signal<string | null>(null);
  protected readonly failed = signal(false);
  protected readonly color = propertyColor;

  private scene: HousesScene | null = null;
  /** The houses' Blender models, loaded once for every rebuild of the scene. */
  private kit: Promise<SceneKit | null> | null = null;
  private readonly injector = inject(Injector);

  constructor() {
    const destroyRef = inject(DestroyRef);
    afterNextRender(() => {
      // Rebuild when the homes change (one added, renamed or deleted).
      const build = effect(
        () => {
          const homes = this.properties();
          this.scene?.dispose();
          this.scene = null;
          const canvas = this.canvas()?.nativeElement;
          if (!canvas || !homes.length) return;
          const motion = !matchMedia('(prefers-reduced-motion: reduce)')
            .matches;
          try {
            this.scene = new HousesScene(
              canvas,
              homes.map((p) => p.id),
              this.palette(),
              motion,
            );
          } catch {
            this.failed.set(true);
            return;
          }
          const scene = this.scene;
          this.kit ??= loadSceneKit(HOUSES_KIT_URL);
          void this.kit.then((kit) => {
            if (kit && this.scene === scene)
              scene.useKit(
                kit,
                Object.fromEntries(homes.map((p) => [p.id, p.type])),
              );
          });
          scene.select(untracked(() => this.selected()));
          for (const house of homes) {
            if (!house.model) continue;
            const url = this.api.modelUrl(house.id, house.model.uploadedAt);
            loadOwnModel(url, house.model.format, () => scene.plainMaterial())
              .then((model) => {
                if (this.scene === scene) scene.setModel(house.id, model);
              })
              .catch((error: unknown) =>
                console.warn(
                  `The 3D model of ${house.name} did not load`,
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
        this.scene?.setPalette(this.palette()),
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
    effect(() => this.scene?.select(this.selected()));
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
    if (id) this.choose(id, event);
  }

  /** A click looks at that house alone (again: all of them); Ctrl, ⌘ or Shift adds it. */
  protected choose(id: string, event: MouseEvent): void {
    const current = this.selected();
    const many = event.ctrlKey || event.metaKey || event.shiftKey;
    const next = many
      ? current.includes(id)
        ? current.filter((x) => x !== id)
        : [...current, id]
      : current.length === 1 && current[0] === id
        ? []
        : [id];
    void this.router.navigate([], {
      queryParams: { ...selectionParams(next), split: null },
      queryParamsHandling: 'merge',
    });
  }

  private local(event: MouseEvent): { x: number; y: number } {
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  /** Resolves the colour tokens above to colours WebGL understands. */
  private palette(): HousesPalette {
    const host = this.host.nativeElement;
    const probe = document.createElement('span');
    probe.style.display = 'none';
    host.appendChild(probe);
    const resolve = (value: string) => {
      probe.style.color = value;
      return toHex(getComputedStyle(probe).color);
    };
    const token = (name: string) => resolve(`var(--houses-${name})`);
    const dark = document.documentElement.dataset['theme'] === 'dark';
    const palette: HousesPalette = {
      grass: token('grass'),
      sand: token('sand'),
      walls: token('walls'),
      door: token('door'),
      window: token('window'),
      glow: dark ? 0.9 : 0.05,
      trunk: token('trunk'),
      leaves: token('leaves'),
      ring: token('ring'),
      roofs: Object.fromEntries(
        this.properties().map((p) => [
          p.id,
          resolve(propertyColor(p.colorSlot)),
        ]),
      ),
    };
    probe.remove();
    return palette;
  }
}
