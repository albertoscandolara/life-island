import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
} from '@angular/core';

export interface BarPart {
  id: string;
  label: string;
  color: string;
  value: number;
}

/** One whole split into parts: a thin bar, with a legend that gives each part's amount and share. */
@Component({
  selector: 'home-segmented-bar',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="bar" role="img" [attr.aria-label]="description()">
      @for (part of shown(); track part.id) {
        <span
          class="part"
          [style.flex-grow]="part.value"
          [style.background]="part.color"
          [title]="part.label + ': ' + format()(part.value)"
        ></span>
      }
    </div>
    <ul class="legend" role="list">
      @for (part of parts(); track part.id) {
        <li>
          <span class="key" [style.background]="part.color"></span>
          <span class="name">{{ part.label }}</span>
          <strong>{{ format()(part.value) }}</strong>
          <span class="share">{{ share(part.value) }}</span>
        </li>
      }
    </ul>
  `,
  styles: `
    :host {
      display: block;
    }
    .bar {
      display: flex;
      gap: calc(var(--space-1) / 2);
      height: var(--space-2);
      margin-bottom: var(--space-3);
      overflow: hidden;
      border-radius: var(--radius-full);
      background: var(--surface-sunken);
    }
    .part {
      flex-basis: 0;
      transform-origin: left;
      animation: grow var(--duration-slow) var(--ease-out) both;
    }
    .legend {
      display: grid;
      gap: var(--space-1);
      margin: 0;
      padding: 0;
      list-style: none;
      font-size: var(--text-sm);
    }
    .legend li {
      display: grid;
      grid-template-columns: var(--space-3) 1fr auto 3.5rem;
      align-items: center;
      gap: var(--space-2);
      color: var(--text-secondary);
    }
    .key {
      width: var(--space-3);
      height: var(--space-3);
      border-radius: var(--radius-sm);
    }
    strong {
      color: var(--text-primary);
      font-variant-numeric: tabular-nums;
    }
    .share {
      color: var(--text-muted);
      text-align: right;
      font-variant-numeric: tabular-nums;
    }
    @keyframes grow {
      from {
        transform: scaleX(0);
      }
    }
  `,
})
export class SegmentedBar {
  readonly parts = input.required<BarPart[]>();
  readonly format = input<(value: number) => string>((v) => String(v));

  private readonly total = computed(() =>
    this.parts().reduce((sum, p) => sum + p.value, 0),
  );
  protected readonly shown = computed(() =>
    this.parts().filter((p) => p.value > 0),
  );

  protected share(value: number): string {
    const total = this.total();
    return total ? `${Math.round((value / total) * 100)}%` : '–';
  }

  protected readonly description = computed(() =>
    this.parts()
      .map(
        (p) => `${p.label} ${this.format()(p.value)} (${this.share(p.value)})`,
      )
      .join(', '),
  );
}
