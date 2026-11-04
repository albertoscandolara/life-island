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
import { barPath, labelEvery, niceScale, observeWidth } from './scale';

export interface ChartSeries {
  id: string;
  label: string;
  /** A colour token, e.g. `var(--viz-gas)`. */
  color: string;
  values: (number | null)[];
}

interface Segment {
  path: string;
  color: string;
  series: number;
}

const LEFT = 64;
const RIGHT = 8;
const TOP = 20;
const BOTTOM = 28;
const GAP = 2;
const MAX_BAR = 24;

/**
 * Columns over time: stacked (the parts of a whole, e.g. utilities in a
 * month) or grouped (side by side, e.g. two homes). One y-axis from zero.
 * Hover or focus a column for every series' value; the legend sits above.
 */
@Component({
  selector: 'home-column-chart',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (series().length > 1) {
      <ul class="legend" role="list">
        @for (s of series(); track s.id) {
          <li>
            <span class="key" [style.background]="s.color"></span>{{ s.label }}
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
      >
        @for (tick of scale().ticks; track tick) {
          <line
            class="grid"
            [class.grid--base]="tick === 0"
            [attr.x1]="left"
            [attr.x2]="width() - right"
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
        @for (column of columns(); track column.key; let i = $index) {
          <g
            class="column"
            [class.column--dim]="hovered() !== null && hovered() !== i"
            [style.--i]="i"
          >
            @for (segment of column.segments; track $index) {
              <path
                class="bar"
                [attr.d]="segment.path"
                [attr.fill]="segment.color"
              />
            }
          </g>
          @if (i % every() === 0 || i === columns().length - 1) {
            <text
              class="tick tick--x"
              [attr.x]="column.center"
              [attr.y]="height() - 8"
              text-anchor="middle"
            >
              {{ shortLabel()(column.key) }}
            </text>
          }
        }
        @for (label of directLabels(); track label.index) {
          <text
            class="value"
            [attr.x]="label.x"
            [attr.y]="label.y"
            text-anchor="middle"
          >
            {{ format()(label.value) }}
          </text>
        }
        @for (column of columns(); track column.key; let i = $index) {
          <rect
            class="hit"
            [attr.x]="column.hitX"
            [attr.y]="top"
            [attr.width]="column.hitWidth"
            [attr.height]="plotHeight()"
            tabindex="0"
            [attr.aria-label]="describe(i)"
            (pointerenter)="hovered.set(i)"
            (pointerleave)="hovered.set(null)"
            (focus)="hovered.set(i)"
            (blur)="hovered.set(null)"
          />
        }
      </svg>
      @if (tooltip(); as tip) {
        <div
          class="tooltip"
          [style.left.px]="tip.x"
          [style.top.px]="top"
          [class.tooltip--left]="tip.flip"
        >
          <div class="tooltip__title">{{ label()(tip.key) }}</div>
          @if (mode() === 'stacked' && series().length > 1) {
            <div class="tooltip__row tooltip__row--total">
              <strong>{{ format()(tip.total) }}</strong
              ><span>Total</span>
            </div>
          }
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
export class ColumnChart {
  readonly buckets = input.required<string[]>();
  readonly series = input.required<ChartSeries[]>();
  readonly mode = input<'stacked' | 'grouped'>('stacked');
  readonly height = input(260);
  readonly format = input<(value: number) => string>((v) => String(v));
  readonly label = input<(key: string) => string>((k) => k);
  readonly shortLabel = input<(key: string) => string>((k) => k);
  readonly ariaLabel = input('Chart');
  /** Shares one scale between small multiples, so their heights compare. */
  readonly maxValue = input<number | null>(null);

  protected readonly left = LEFT;
  protected readonly right = RIGHT;
  protected readonly top = TOP;
  protected readonly width = signal(600);
  protected readonly hovered = signal<number | null>(null);

  protected readonly plotHeight = computed(() => this.height() - TOP - BOTTOM);
  private readonly plotWidth = computed(() =>
    Math.max(1, this.width() - LEFT - RIGHT),
  );
  private readonly band = computed(
    () => this.plotWidth() / Math.max(1, this.buckets().length),
  );

  private readonly totals = computed(() =>
    this.buckets().map((_, i) =>
      this.series().reduce((sum, s) => sum + (s.values[i] ?? 0), 0),
    ),
  );

  protected readonly scale = computed(() => {
    const max =
      this.mode() === 'stacked'
        ? Math.max(0, ...this.totals())
        : Math.max(
            0,
            ...this.series().flatMap((s) => s.values.map((v) => v ?? 0)),
          );
    return niceScale(Math.max(max, this.maxValue() ?? 0));
  });

  protected readonly every = computed(() =>
    labelEvery(this.buckets().length, this.plotWidth(), 56),
  );

  protected readonly columns = computed(() => {
    const band = this.band();
    const series = this.series();
    return this.buckets().map((key, i) => {
      const center = LEFT + band * (i + 0.5);
      const segments: Segment[] = [];
      if (this.mode() === 'stacked') {
        const width = Math.min(MAX_BAR, band * 0.64);
        let base = 0;
        series.forEach((s, si) => {
          const value = s.values[i] ?? 0;
          if (value <= 0) return;
          const y0 = this.y(base);
          const y1 = this.y(base + value);
          base += value;
          // The surface gap: each segment gives up 2px at its base.
          const isBottom = segments.length === 0;
          const height = y0 - y1 - (isBottom ? 0 : GAP);
          const isTop = series
            .slice(si + 1)
            .every((other) => !(other.values[i] ?? 0));
          segments.push({
            path: isTop
              ? barPath(center - width / 2, y1, width, height)
              : rectPath(center - width / 2, y1, width, height),
            color: s.color,
            series: si,
          });
        });
      } else {
        const count = series.length;
        const group = Math.min(band * 0.8, MAX_BAR * count + GAP * (count - 1));
        const width = Math.max(2, (group - GAP * (count - 1)) / count);
        series.forEach((s, si) => {
          const value = s.values[i] ?? 0;
          if (value <= 0) return;
          const x = center - group / 2 + si * (width + GAP);
          segments.push({
            path: barPath(x, this.y(value), width, this.y(0) - this.y(value)),
            color: s.color,
            series: si,
          });
        });
      }
      return {
        key,
        center,
        segments,
        hitX: LEFT + band * i,
        hitWidth: band,
      };
    });
  });

  /** The tallest column and the last one carry their value; the rest live in the tooltip and table. */
  protected readonly directLabels = computed(() => {
    if (this.mode() !== 'stacked') return [];
    const totals = this.totals();
    if (!totals.length) return [];
    const max = totals.indexOf(Math.max(...totals));
    const last = totals.length - 1;
    return [...new Set([max, last])]
      .filter((index) => totals[index] > 0)
      .map((index) => ({
        index,
        value: totals[index],
        x: this.columns()[index].center,
        y: this.y(totals[index]) - 6,
      }));
  });

  protected readonly tooltip = computed(() => {
    const i = this.hovered();
    if (i === null) return null;
    const column = this.columns()[i];
    if (!column) return null;
    return {
      key: column.key,
      x: column.center,
      flip: column.center > this.width() * 0.6,
      total: this.totals()[i],
      rows: this.series().map((s) => ({
        label: s.label,
        color: s.color,
        value: s.values[i],
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

  protected y(value: number): number {
    return TOP + this.plotHeight() * (1 - value / this.scale().max);
  }

  protected describe(i: number): string {
    const parts = this.series()
      .map((s) => `${s.label} ${this.format()(s.values[i] ?? 0)}`)
      .join(', ');
    return `${this.label()(this.buckets()[i])}: ${parts}`;
  }
}

function rectPath(x: number, y: number, width: number, height: number): string {
  if (height <= 0) return '';
  return `M${x},${y} H${x + width} V${y + height} H${x} Z`;
}
