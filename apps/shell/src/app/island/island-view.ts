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
import { IslandScene, type IslandPalette } from './island-scene';

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
      scene.onFrame = (positions) => {
        const labels = this.labels();
        positions.forEach((position, i) => {
          const label = labels[i]?.nativeElement;
          if (!label) return;
          label.style.transform = `translate(-50%, -100%) translate(${position.x}px, ${position.y}px)`;
          label.style.opacity = String(0.25 + position.facing * 0.75);
          label.style.zIndex = String(Math.round(position.facing * 10));
        });
      };
      const resize = new ResizeObserver(([entry]) =>
        scene.resize(entry.contentRect.width, entry.contentRect.height),
      );
      resize.observe(this.host.nativeElement);
      // Repaint when the theme changes (light/dark switch on <html>).
      const theme = new MutationObserver(() =>
        scene.setPalette(this.palette()),
      );
      theme.observe(document.documentElement, {
        attributeFilter: ['data-theme'],
      });
      scene.start();
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
