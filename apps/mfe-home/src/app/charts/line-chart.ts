import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  ElementRef,
  afterNextRender,
  inject,
  input,
  signal,
} from '@angular/core';
import type { ChartSeries } from './column-chart';
import { labelEvery, niceScale, observeWidth } from './scale';

const LEFT = 64;
const TOP = 16;
const BOTTOM = 28;

/**
 * Lines over shared x positions (months, or January–December for a
 * year-over-year view). A crosshair snaps to the nearest position and the
 * tooltip lists every series there; up to four lines are labelled at their end.
 */
@Component({
  selector: 'home-line-chart',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (series().length > 1) {
      <ul class="legend" role="list">
        @for (s of series(); track s.id) {
          <li>
            <span class="key key--line" [style.background]="s.color"></span
            >{{ s.label }}
          </li>
        }
      </ul>
    }
    <div class="frame" [style.height.px]="height()">
      <svg
        class="svg"
        [attr.width]="width()"
        [attr.height]="height()"
        role="img"
        [attr.aria-label]="ariaLabel()"
        (pointermove)="track($event)"
        (pointerleave)="hovered.set(null)"
      >
        @for (tick of scale().ticks; track tick) {
          <line
            class="grid"
            [class.grid--base]="tick === 0"
            [attr.x1]="left"
            [attr.x2]="width() - right()"
            [attr.y1]="y(tick)"
            [attr.y2]="y(tick)"
          />
          <text
            class="tick"
            [attr.x]="left - 8"
            [attr.y]="y(tick)"
            dy="0.32em"
            text-anchor="end"
          >
            {{ format()(tick) }}
          </text>
        }
        @for (label of categories(); track $index; let i = $index) {
          @if (i % every() === 0 || i === categories().length - 1) {
            <text
              class="tick tick--x"
              [attr.x]="x(i)"
              [attr.y]="height() - 8"
              text-anchor="middle"
            >
              {{ label }}
            </text>
          }
        }
        @if (hovered() !== null) {
          <line
            class="crosshair"
            [attr.x1]="x(hovered()!)"
            [attr.x2]="x(hovered()!)"
            [attr.y1]="top"
            [attr.y2]="height() - bottom"
          />
        }
        @for (line of lines(); track line.id) {
          @if (line.area) {
            <path class="area" [attr.d]="line.area" [attr.fill]="line.color" />
          }
          @for (d of line.paths; track $index) {
            <path
              class="line draw"
              pathLength="1"
              [attr.d]="d"
              [attr.stroke]="line.color"
            />
          }
          @if (line.end) {
            <circle
              class="dot"
              [attr.cx]="line.end.x"
              [attr.cy]="line.end.y"
              r="4"
              [attr.fill]="line.color"
            />
          }
          @if (hovered() !== null && line.points[hovered()!]; as p) {
            <circle
              class="dot"
              [attr.cx]="p.x"
              [attr.cy]="p.y"
              r="4.5"
              [attr.fill]="line.color"
            />
          }
        }
        @for (label of endLabels(); track label.id) {
          <text
            class="end-label"
            [attr.x]="label.x + 8"
            [attr.y]="label.y"
            dy="0.32em"
          >
            {{ label.text }}
          </text>
        }
        <rect
          class="hit"
          [attr.x]="left"
          [attr.y]="top"
          [attr.width]="plotWidth()"
          [attr.height]="height() - top - bottom"
          tabindex="0"
          [attr.aria-label]="
            ariaLabel() + ': use the arrow keys to read each point'
          "
          (focus)="hovered.set(hovered() ?? categories().length - 1)"
          (blur)="hovered.set(null)"
          (keydown)="key($event)"
        />
      </svg>
      @if (tooltip(); as tip) {
        <div
          class="tooltip"
          [style.left.px]="tip.x"
          [style.top.px]="top"
          [class.tooltip--left]="tip.flip"
        >
          <div class="tooltip__title">{{ tip.title }}</div>
          @for (row of tip.rows; track row.label) {
            <div class="tooltip__row">
              <span class="line" [style.background]="row.color"></span>
              <strong>{{
                row.value === null ? '–' : format()(row.value)
              }}</strong>
              <span>{{ row.label }}</span>
            </div>
          }
        </div>
      }
    </div>
  `,
  styleUrl: './chart.css',
})
export class LineChart {
  readonly categories = input.required<string[]>();
  readonly series = input.required<ChartSeries[]>();
  readonly height = input(260);
  readonly format = input<(value: number) => string>((v) => String(v));
  /** Full name of a position for the tooltip, e.g. "March". */
  readonly title = input<(index: number) => string>((i) => String(i));
  readonly ariaLabel = input('Chart');
  /** A soft wash under a single line. */
  readonly area = input(true);

  protected readonly left = LEFT;
  protected readonly top = TOP;
  protected readonly bottom = BOTTOM;
  protected readonly width = signal(600);
  protected readonly hovered = signal<number | null>(null);

  /** Room on the right for end labels when they are shown. */
  protected readonly right = computed(() =>
    this.series().length <= 4 ? 64 : 12,
  );
  protected readonly plotWidth = computed(() =>
    Math.max(1, this.width() - LEFT - this.right()),
  );
  protected readonly every = computed(() =>
    labelEvery(this.categories().length, this.plotWidth(), 44),
  );

  protected readonly scale = computed(() =>
    niceScale(
      Math.max(0, ...this.series().flatMap((s) => s.values.map((v) => v ?? 0))),
    ),
  );

  protected readonly lines = computed(() =>
    this.series().map((s) => {
      const points = s.values.map((v, i) =>
        v === null ? null : { x: this.x(i), y: this.y(v) },
      );
      // A gap in the data breaks the line instead of drawing through it.
      const paths: string[] = [];
      let current: string[] = [];
      for (const p of points) {
        if (p) current.push(`${current.length ? 'L' : 'M'}${p.x},${p.y}`);
        else if (current.length) {
          paths.push(current.join(' '));
          current = [];
        }
      }
      if (current.length) paths.push(current.join(' '));
      const defined = points.filter(
        (p): p is { x: number; y: number } => p !== null,
      );
      const end = defined[defined.length - 1] ?? null;
      const area =
        this.area() && this.series().length === 1 && defined.length > 1
          ? `M${defined[0].x},${this.y(0)} ${defined.map((p) => `L${p.x},${p.y}`).join(' ')} L${end!.x},${this.y(0)} Z`
          : null;
      return {
        id: s.id,
        label: s.label,
        color: s.color,
        points,
        paths,
        end,
        area,
      };
    }),
  );

  /** Direct labels at line ends; when two would collide, the legend and tooltip carry them instead. */
  protected readonly endLabels = computed(() => {
    if (this.series().length > 4) return [];
    const labels = this.lines()
      .filter((line) => line.end)
      .map((line) => ({
        id: line.id,
        text: line.label,
        x: line.end!.x,
        y: line.end!.y,
      }))
      .sort((a, b) => a.y - b.y);
    const collide = labels.some((l, i) => i > 0 && l.y - labels[i - 1].y < 14);
    return collide || this.series().length < 2 ? [] : labels;
  });

  protected readonly tooltip = computed(() => {
    const i = this.hovered();
    if (i === null) return null;
    const x = this.x(i);
    return {
      x,
      flip: x > this.width() * 0.6,
      title: this.title()(i),
      rows: this.series().map((s) => ({
        label: s.label,
        color: s.color,
        value: s.values[i] ?? null,
      })),
    };
  });

  constructor() {
    const host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
    const destroyRef = inject(DestroyRef);
    afterNextRender(() => {
      const stop = observeWidth(host, (width) =>
        this.width.set(Math.max(240, width)),
      );
      destroyRef.onDestroy(stop);
    });
  }

  protected x(i: number): number {
    const count = this.categories().length;
    return count <= 1
      ? LEFT + this.plotWidth() / 2
      : LEFT + (this.plotWidth() * i) / (count - 1);
  }

  protected y(value: number): number {
    const plot = this.height() - TOP - BOTTOM;
    return TOP + plot * (1 - value / this.scale().max);
  }

  protected track(event: PointerEvent): void {
    const svg = event.currentTarget as SVGElement;
    const left = event.clientX - svg.getBoundingClientRect().left;
    const count = this.categories().length;
    if (!count) return;
    const step = count <= 1 ? 1 : this.plotWidth() / (count - 1);
    const i = Math.round((left - LEFT) / step);
    this.hovered.set(Math.max(0, Math.min(count - 1, i)));
  }

  protected key(event: KeyboardEvent): void {
    const count = this.categories().length;
    const current = this.hovered() ?? count - 1;
    if (event.key === 'ArrowLeft') this.hovered.set(Math.max(0, current - 1));
    else if (event.key === 'ArrowRight')
      this.hovered.set(Math.min(count - 1, current + 1));
    else return;
    event.preventDefault();
  }
}
