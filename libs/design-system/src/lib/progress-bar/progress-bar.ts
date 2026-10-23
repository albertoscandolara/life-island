import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
} from '@angular/core';

/** Determinate progress from 0 to 100; `null` shows an indeterminate bar. */
@Component({
  selector: 'ui-progress-bar',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    role: 'progressbar',
    'aria-valuemin': '0',
    'aria-valuemax': '100',
    '[attr.aria-valuenow]': 'value()',
    '[attr.aria-label]': 'label()',
  },
  template: `<span
    class="bar"
    [class.bar--indeterminate]="value() === null"
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
      background: var(--accent);
      transition: width var(--duration-normal);
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
  protected readonly width = computed(() => {
    const value = this.value();
    return value === null ? null : `${Math.min(100, Math.max(0, value))}%`;
  });
}
