import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { UiIcon, type UiIconName } from '../icon/icon';

/** Where an AI request stands. `off`: the tool is switched off or has no key. */
export type UiAiState =
  'idle' | 'working' | 'done' | 'warning' | 'error' | 'off';

const ICON: Partial<Record<UiAiState, UiIconName>> = {
  done: 'check',
  warning: 'alert',
  error: 'alert',
  off: 'info',
};

/**
 * One line that says where an AI request stands, the same in every module:
 * `<ui-ai-status state="working">Searching the web: this takes a minute.</ui-ai-status>`.
 * Working pulses the AI mark; warnings and errors take the warning and danger
 * tones and are announced.
 */
@Component({
  selector: 'ui-ai-status',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [UiIcon],
  host: {
    '[attr.data-state]': 'state()',
    '[attr.role]': "state() === 'error' ? 'alert' : 'status'",
  },
  template: `@if (state() === 'working') {
      <span class="spark" aria-hidden="true"
        ><ui-icon name="sparkles" [size]="14"
      /></span>
    } @else if (icon(); as name) {
      <ui-icon [name]="name" [size]="14" />
    }
    <span class="text"><ng-content /></span>`,
  styles: `
    :host {
      display: inline-flex;
      align-items: center;
      gap: var(--space-2);
      color: var(--text-secondary);
      font-size: var(--text-sm);
    }
    :host([data-state='working']),
    :host([data-state='done']) {
      color: var(--ai-text);
    }
    :host([data-state='warning']) {
      color: var(--tone-warning);
    }
    :host([data-state='error']) {
      color: var(--danger);
    }
    .spark {
      display: inline-flex;
      animation: ai-pulse 1.4s ease-in-out infinite;
    }
    @keyframes ai-pulse {
      50% {
        opacity: 0.35;
        transform: scale(0.85);
      }
    }
    @media (prefers-reduced-motion: reduce) {
      .spark {
        animation: none;
      }
    }
  `,
})
export class UiAiStatus {
  readonly state = input<UiAiState>('idle');
  protected icon(): UiIconName | undefined {
    return ICON[this.state()];
  }
}
