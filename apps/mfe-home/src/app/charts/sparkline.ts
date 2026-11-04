import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
} from '@angular/core';

/** A tiny trend line for a stat tile: the last point in the colour, the rest muted. */
@Component({
  selector: 'home-sparkline',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <svg
      [attr.viewBox]="'0 0 ' + w + ' ' + h"
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      <path
        class="spark"
        pathLength="1"
        [attr.d]="path()"
        [attr.stroke]="color()"
      />
      @if (last(); as p) {
        <circle [attr.cx]="p.x" [attr.cy]="p.y" r="2.5" [attr.fill]="color()" />
      }
    </svg>
  `,
  styles: `
    :host {
      display: block;
      height: var(--space-8);
    }
    svg {
      display: block;
      width: 100%;
      height: 100%;
      overflow: visible;
    }
    .spark {
      fill: none;
      stroke-width: 2;
      stroke-linecap: round;
      stroke-linejoin: round;
      vector-effect: non-scaling-stroke;
    }
    svg {
      clip-path: inset(0 100% 0 0);
      animation: reveal 900ms var(--ease-out) forwards;
    }
    @keyframes reveal {
      to {
        clip-path: inset(0 0 0 0);
      }
    }
  `,
})
export class Sparkline {
  readonly values = input.required<number[]>();
  readonly color = input('var(--accent)');

  protected readonly w = 120;
  protected readonly h = 32;

  private readonly points = computed(() => {
    const values = this.values();
    const max = Math.max(...values, 0) || 1;
    const step = values.length > 1 ? this.w / (values.length - 1) : 0;
    return values.map((v, i) => ({
      x: i * step,
      y: this.h - 2 - (v / max) * (this.h - 4),
    }));
  });

  protected readonly path = computed(() =>
    this.points()
      .map((p, i) => `${i ? 'L' : 'M'}${p.x},${p.y}`)
      .join(' '),
  );

  protected readonly last = computed(() => this.points().at(-1) ?? null);
}
