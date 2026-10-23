import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import type { UiTone } from '../status-dot/status-dot';

/** A small rounded label: `<ui-badge tone="info">Groceries</ui-badge>`. */
@Component({
  selector: 'ui-badge',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '[style.--_tone]': "'var(--tone-' + tone() + ')'",
    '[style.--_tone-soft]': "'var(--tone-' + tone() + '-soft)'",
  },
  template: `<ng-content />`,
  styles: `
    :host {
      display: inline-flex;
      align-items: center;
      gap: var(--space-1);
      padding: calc(var(--space-1) / 2) var(--space-2);
      border-radius: var(--radius-full);
      background: var(--_tone-soft);
      color: var(--_tone);
      font-size: var(--text-xs);
      font-weight: 600;
      white-space: nowrap;
    }
  `,
})
export class UiBadge {
  readonly tone = input<UiTone>('neutral');
}
