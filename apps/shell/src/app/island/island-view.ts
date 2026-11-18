import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  inject,
  input,
  output,
  signal,
  viewChild,
  viewChildren,
} from '@angular/core';
import type { IslandModule } from '../hub/modules';
import { visibleLabels } from './island-layout';
import {
  ISLAND_KIT_URL,
  IslandScene,
  type IslandPalette,
} from './island-scene';

/**
 * The 3D island hub: one zone per area of life. Hover a zone (or its label)
 * to highlight it, drag to turn the island, click to fly in and open it.
 * Labels are real links and buttons, so the island also works by keyboard.
 */
@Component({
  selector: 'app-island-view',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './island-view.html',
  styleUrl: './island-view.css',
})
export class IslandView {
  readonly modules = input.required<readonly IslandModule[]>();
  /** A live area was chosen; the camera has landed on it. */
  readonly open = output<IslandModule>();

  protected readonly hovered = signal<string | null>(null);
  protected readonly failed = signal(false);

  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly canvas =
    viewChild.required<ElementRef<HTMLCanvasElement>>('canvas');
  private readonly labels = viewChildren<ElementRef<HTMLElement>>('label');
  private scene: IslandScene | null = null;
  private pointer: { x: number; moved: boolean } | null = null;

  constructor() {
    const destroyRef = inject(DestroyRef);
    afterNextRender(() => {
      const motion = !matchMedia('(prefers-reduced-motion: reduce)').matches;
      try {
        this.scene = new IslandScene(
          this.canvas().nativeElement,
          this.modules(),
          this.palette(),
          motion,
        );
      } catch {
        // No WebGL: the area cards under the island still open everything.
        this.failed.set(true);
        return;
      }
      const scene = this.scene;
      // Label sizes, measured once and again after a resize (not every frame).
      let sizes: { width: number; height: number }[] = [];
      scene.onFrame = (positions) => {
        const labels = this.labels();
        if (sizes.length !== labels.length)
          sizes = labels.map(({ nativeElement: el }) => ({
            width: el.offsetWidth,
            height: el.offsetHeight,
          }));
        const shown = visibleLabels(
          positions.map((position, i) => ({
            ...position,
            // The anchor is the label's bottom centre: move to its middle.
            y: position.y - (sizes[i]?.height ?? 0) / 2,
            width: sizes[i]?.width ?? 0,
            height: sizes[i]?.height ?? 0,
          })),
          this.hovered(),
        );
        positions.forEach((position, i) => {
          const label = labels[i]?.nativeElement;
          if (!label) return;
          const on = shown.has(position.id);
          label.style.transform = `translate(-50%, -100%) translate(${position.x}px, ${position.y}px)`;
          label.style.opacity = on
            ? String(0.55 + position.facing * 0.45)
            : '0';
          label.classList.toggle('label--hidden', !on);
          label.style.zIndex = String(Math.round(position.facing * 10));
        });
      };
      const resize = new ResizeObserver(([entry]) => {
        scene.resize(entry.contentRect.width, entry.contentRect.height);
        sizes = [];
      });
      resize.observe(this.host.nativeElement);
      // Repaint when the theme changes (light/dark switch on <html>).
      const theme = new MutationObserver(() =>
        scene.setPalette(this.palette()),
      );
      theme.observe(document.documentElement, {
        attributeFilter: ['data-theme'],
      });
      scene.start();
      // The Blender models arrive after the first frame; until then (or if
      // they never load) the island stands in primitives.
      void scene.loadKit(new URL(ISLAND_KIT_URL, document.baseURI).href);
      destroyRef.onDestroy(() => {
        resize.disconnect();
        theme.disconnect();
        scene.dispose();
      });
    });
  }

  protected hover(id: string | null): void {
    this.hovered.set(id);
    this.scene?.highlight(id);
  }

  protected async choose(module: IslandModule): Promise<void> {
    if (!module.path) {
      this.hover(module.id);
      return;
    }
    await this.scene?.flyTo(module.id);
    this.open.emit(module);
  }

  protected onPointerDown(event: PointerEvent): void {
    this.pointer = { x: event.clientX, moved: false };
    (event.target as HTMLElement).setPointerCapture?.(event.pointerId);
  }

  protected onPointerMove(event: PointerEvent): void {
    if (this.pointer) {
      const dx = event.clientX - this.pointer.x;
      if (Math.abs(dx) > 3) this.pointer.moved = true;
      if (this.pointer.moved) {
        this.scene?.drag(dx);
        this.pointer.x = event.clientX;
      }
      return;
    }
    const { x, y } = this.local(event);
    const id = this.scene?.pick(x, y) ?? null;
    if (id !== this.hovered()) this.hover(id);
  }

  protected onPointerUp(event: PointerEvent): void {
    const pointer = this.pointer;
    this.pointer = null;
    this.scene?.endDrag();
    if (pointer?.moved) return;
    const { x, y } = this.local(event);
    const id = this.scene?.pick(x, y);
    const module = this.modules().find((m) => m.id === id);
    if (module) void this.choose(module);
  }

  private local(event: PointerEvent): { x: number; y: number } {
    const rect = this.canvas().nativeElement.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  /** Resolves the island's colour tokens (island-view.css) to colours WebGL understands. */
  private palette(): IslandPalette {
    const host = this.host.nativeElement;
    const probe = document.createElement('span');
    probe.style.display = 'none';
    host.appendChild(probe);
    const resolve = (value: string, character?: string) => {
      if (character) probe.dataset['character'] = character;
      else delete probe.dataset['character'];
      probe.style.color = value;
      return toHex(getComputedStyle(probe).color);
    };
    const token = (name: string) => resolve(`var(--island-${name})`);
    const palette: IslandPalette = {
      fog: token('fog'),
      water: token('water'),
      foam: token('foam'),
      sand: token('sand'),
      grass: token('grass'),
      rock: token('rock'),
      trunk: token('trunk'),
      leaves: token('leaves'),
      shallow: token('shallow'),
      window: token('window'),
      wall: token('wall'),
      night: luminance(token('fog')) < 0.35,
      planned: token('planned'),
      zones: {},
    };
    for (const module of this.modules())
      if (module.character && module.path)
        palette.zones[module.id] = resolve('var(--accent)', module.character);
    probe.remove();
    return palette;
  }
}

/** `rgb(…)`, `rgba(…)` or `color(srgb …)` to `#rrggbb` (what three.js reads). */
export function toHex(css: string): string {
  const srgb = /color\(srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)/.exec(css);
  const rgb = /rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/.exec(css);
  const channels = srgb
    ? srgb.slice(1, 4).map((v) => Number(v) * 255)
    : rgb
      ? rgb.slice(1, 4).map(Number)
      : [128, 128, 128];
  return (
    '#' +
    channels
      .map((v) =>
        Math.round(Math.max(0, Math.min(255, v)))
          .toString(16)
          .padStart(2, '0'),
      )
      .join('')
  );
}

/** Relative luminance (0–1) of a `#rrggbb` colour: tells the dark theme apart. */
export function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map(
    (i) => parseInt(hex.slice(i, i + 2), 16) / 255,
  );
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
