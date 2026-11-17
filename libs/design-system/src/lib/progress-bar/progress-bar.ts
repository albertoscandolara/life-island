import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
} from '@angular/core';

/**
 * How the bar is filled: the character's accent for progress towards a goal
 * (the next step), a status tone for a meter that can run over (a budget).
 */
export type UiProgressTone = 'accent' | 'success' | 'warning' | 'danger';

/**
 * Determinate progress from 0 to 100; `null` shows an indeterminate bar.
 * Areas use it for every progress bar and meter instead of drawing their own.
 */
@Component({
  selector: 'ui-progress-bar',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    role: 'progressbar',
    'aria-valuemin': '0',
    'aria-valuemax': '100',
    '[attr.aria-valuenow]': 'clamped()',
    '[attr.aria-label]': 'label()',
    '[class.size-md]': "size() === 'md'",
  },
  template: `<span
    class="bar"
    [class.bar--indeterminate]="value() === null"
    [class]="'bar--' + tone()"
    [style.width]="width()"
  ></span>`,
  styles: `
    :host {
      display: block;
      height: var(--space-1);
      overflow: hidden;
      border-radius: var(--radius-full);
      background: var(--surface-sunken);
    }
    .bar {
      display: block;
      height: 100%;
      border-radius: inherit;
      background: var(--accent-gradient);
      transition: width var(--duration-normal) var(--ease-out);
    }
    :host(.size-md) {
      height: var(--space-2);
    }
    .bar--success {
      background: var(--tone-success);
    }
    .bar--warning {
      background: var(--tone-warning);
    }
    .bar--danger {
      background: var(--tone-danger);
    }
    .bar--indeterminate {
      width: 30%;
      animation: slide 1.2s ease-in-out infinite;
    }
    @keyframes slide {
      from {
        transform: translateX(-100%);
      }
      to {
        transform: translateX(350%);
      }
    }
  `,
})
export class UiProgressBar {
  readonly value = input<number | null>(null);
  readonly label = input('Progress');
  readonly tone = input<UiProgressTone>('accent');
  /** sm: a thin line under a row; md: a meter that carries the number beside it. */
  readonly size = input<'sm' | 'md'>('sm');
  protected readonly clamped = computed(() => {
    const value = this.value();
    return value === null ? null : Math.min(100, Math.max(0, value));
  });
  protected readonly width = computed(() => {
    const value = this.clamped();
    return value === null ? null : `${value}%`;
  });
}
