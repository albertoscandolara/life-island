import { ChangeDetectionStrategy, Component, input } from '@angular/core';

export type UiTone =
  'neutral' | 'info' | 'progress' | 'warning' | 'success' | 'danger';

/** A coloured dot, optionally followed by a label: `<ui-status-dot tone="success" label="Loaded" />`. */
@Component({
  selector: 'ui-status-dot',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[style.--_tone]': "'var(--tone-' + tone() + ')'" },
  template: `<span
      class="dot"
      [class.dot--pulse]="pulse()"
      aria-hidden="true"
    ></span>
    @if (label()) {
      <span class="label">{{ label() }}</span>
    }`,
  styles: `
    :host {
      display: inline-flex;
      align-items: center;
      gap: var(--space-2);
      white-space: nowrap;
    }
    .dot {
      width: 0.625rem;
      height: 0.625rem;
      flex-shrink: 0;
      border-radius: var(--radius-full);
      background: var(--_tone);
      box-shadow: 0 0 0 3px color-mix(in srgb, var(--_tone) 20%, transparent);
    }
    .dot--pulse {
      animation: pulse 1.4s ease-in-out infinite;
    }
    @keyframes pulse {
      50% {
        opacity: 0.4;
      }
    }
  `,
})
export class UiStatusDot {
  readonly tone = input<UiTone>('neutral');
  readonly label = input('');
  /** Animate the dot, for states that are in progress. */
  readonly pulse = input(false);
}
