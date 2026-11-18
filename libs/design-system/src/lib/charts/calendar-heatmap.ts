import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  ElementRef,
  afterNextRender,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { calendarGrid, heatLevel } from './calendar';
import { observeWidth } from './scale';

const LEFT = 32;
const TOP = 18;
const GAP = 3;
const WEEKDAYS = ['Mon', '', 'Wed', '', 'Fri', '', ''];
const OPACITY = [0, 0.3, 0.55, 0.8, 1];

/**
 * Days as squares, a column a week and a row a weekday, the colour stronger
 * as the day holds more: the busy months of a year, or the days a habit was
 * kept. Hover or focus a day to read it on the line below (a floating
 * tooltip would be cut by the sideways scroll on a phone); with `pickable`, a
 * click or Enter opens what is behind it.
 */
@Component({
  selector: 'ui-calendar-heatmap',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="scroll">
      <div
        class="frame"
        [style.height.px]="height()"
        [style.width.px]="contentWidth()"
      >
        <svg
          class="svg"
          [attr.width]="contentWidth()"
          [attr.height]="height()"
          role="img"
          [attr.aria-label]="ariaLabel()"
          (pointerleave)="hovered.set(null)"
        >
          @for (m of grid().months; track m.week) {
            <text class="tick" [attr.x]="x(m.week)" [attr.y]="12">
              {{ m.label }}
            </text>
          }
          @for (label of weekdays; track $index; let i = $index) {
            @if (label) {
              <text
                class="tick"
                [attr.x]="left - 6"
                [attr.y]="y(i) + cell() / 2"
                dy="0.32em"
                text-anchor="end"
              >
                {{ label }}
              </text>
            }
          }
          @for (c of cells(); track c.date; let i = $index) {
            <rect
              class="day"
              [class.day--empty]="!c.level"
              [class.day--pickable]="pickable() && c.value"
              [class.day--on]="hovered() === i"
              [attr.x]="x(c.week)"
              [attr.y]="y(c.weekday)"
              [attr.width]="cell()"
              [attr.height]="cell()"
              rx="2"
              [style.fill]="c.level ? color() : null"
              [style.fill-opacity]="c.level ? opacity[c.level] : null"
              (pointerenter)="hovered.set(i)"
              (click)="open(i)"
            />
          }
          <rect
            class="hit hit--keys"
            [attr.x]="0"
            [attr.y]="0"
            width="1"
            height="1"
            tabindex="0"
            [attr.aria-label]="
              ariaLabel() + ': use the arrow keys to read each day'
            "
            (focus)="hovered.set(hovered() ?? cells().length - 1)"
            (blur)="hovered.set(null)"
            (keydown)="key($event)"
          />
        </svg>
      </div>
    </div>
    <p class="readout" role="status">
      @if (tooltip(); as tip) {
        <span class="key" [style.background]="color()"></span>
        <strong>{{ tip.title }}</strong>
        <span>{{ tip.value }}</span>
        @if (tip.detail) {
          <span class="readout__detail">{{ tip.detail }}</span>
        }
      } @else {
        <span class="readout__hint">{{ hint() }}</span>
      }
    </p>
  `,
  styleUrl: './chart.css',
  styles: `
    .scroll {
      overflow-x: auto;
      overflow-y: hidden;
      padding: 4px;
    }
    .readout {
      display: flex;
      flex-wrap: wrap;
      gap: var(--space-1) var(--space-2);
      align-items: center;
      min-height: 1.5em;
      margin: var(--space-2) 0 0;
      color: var(--text-secondary);
      font-size: var(--text-xs);
    }
    .readout strong {
      color: var(--text-primary);
    }
    .readout__detail,
    .readout__hint {
      color: var(--text-muted);
    }
    .day {
      fill: var(--viz-grid);
      transition: stroke var(--duration-fast) var(--ease-out);
    }
    .day--pickable {
      cursor: pointer;
    }
    .day--on {
      stroke: var(--text-primary);
      stroke-width: 1.5;
    }
    .hit--keys {
      fill: transparent;
      cursor: default;
    }
    .scroll:has(.hit--keys:focus-visible) {
      outline: 2px solid var(--focus-ring, var(--accent));
      outline-offset: 4px;
      border-radius: var(--radius-sm);
    }
  `,
})
export class UiCalendarHeatmap {
  /** First and last day shown, `YYYY-MM-DD`. */
  readonly from = input.required<string>();
  readonly to = input.required<string>();
  /** The value of each day that has one, by `YYYY-MM-DD`. */
  readonly values = input.required<Readonly<Record<string, number>>>();
  /** A colour token, e.g. `var(--viz-1)`. */
  readonly color = input('var(--viz-1)');
  readonly format = input<(value: number) => string>((v) => String(v));
  /** The day's name for the tooltip, e.g. "Mon 3 Nov". */
  readonly title = input<(date: string) => string>((d) => d);
  /** A line under the value, e.g. the amounts due that day. */
  readonly detail = input<(date: string) => string | null>(() => null);
  readonly ariaLabel = input('Calendar');
  /** The line under the days while none is hovered. */
  readonly hint = input('Point at a day, or focus it and use the arrow keys.');
  /** The largest square, in px; smaller when the weeks do not fit. */
  readonly maxCell = input(16);
  /** Days with a value open what is behind them. */
  readonly pickable = input(false);
  readonly pick = output<string>();

  protected readonly left = LEFT;
  protected readonly weekdays = WEEKDAYS;
  protected readonly opacity = OPACITY;
  protected readonly width = signal(600);
  protected readonly hovered = signal<number | null>(null);

  protected readonly grid = computed(() =>
    calendarGrid(this.from(), this.to()),
  );

  protected readonly cell = computed(() => {
    const weeks = Math.max(1, this.grid().weeks);
    const fit = Math.floor((this.width() - LEFT) / weeks) - GAP;
    return Math.max(9, Math.min(this.maxCell(), fit));
  });

  protected readonly height = computed(() => TOP + 7 * (this.cell() + GAP));
  /** Wider than the host on a phone: the host scrolls sideways. */
  protected readonly contentWidth = computed(
    () => LEFT + this.grid().weeks * (this.cell() + GAP),
  );

  protected readonly cells = computed(() => {
    const values = this.values();
    const max = Math.max(0, ...Object.values(values));
    return this.grid().cells.map((c) => ({
      ...c,
      value: values[c.date] ?? 0,
      level: heatLevel(values[c.date], max),
    }));
  });

  protected readonly tooltip = computed(() => {
    const i = this.hovered();
    const c = i === null ? null : this.cells()[i];
    if (!c) return null;
    return {
      title: this.title()(c.date),
      value: this.format()(c.value),
      detail: this.detail()(c.date),
    };
  });

  constructor() {
    const host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
    const destroyRef = inject(DestroyRef);
    afterNextRender(() => {
      const stop = observeWidth(host, (width) =>
        this.width.set(Math.max(200, width)),
      );
      destroyRef.onDestroy(stop);
    });
  }

  protected x(week: number): number {
    return LEFT + week * (this.cell() + GAP);
  }

  protected y(weekday: number): number {
    return TOP + weekday * (this.cell() + GAP);
  }

  protected open(i: number): void {
    const c = this.cells()[i];
    if (this.pickable() && c?.value) this.pick.emit(c.date);
  }

  protected key(event: KeyboardEvent): void {
    const count = this.cells().length;
    const current = this.hovered() ?? count - 1;
    const step: Record<string, number> = {
      ArrowLeft: -7,
      ArrowRight: 7,
      ArrowUp: -1,
      ArrowDown: 1,
    };
    if (event.key === 'Enter') this.open(current);
    else if (event.key in step)
      this.hovered.set(
        Math.max(0, Math.min(count - 1, current + step[event.key])),
      );
    else return;
    event.preventDefault();
  }
}
