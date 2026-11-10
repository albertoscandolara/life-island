import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { UiIcon } from '../icon/icon';

/**
 * The AI mark: a sparkle and a short label in the AI colour, e.g.
 * `<ui-ai-badge />` (says "AI"), `<ui-ai-badge label="Written by Claude" />`.
 * Put it wherever content or an action comes from a model. `muted` is the
 * same mark in grey, for an AI tool that is off.
 */
@Component({
  selector: 'ui-ai-badge',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [UiIcon],
  host: { '[class.muted]': 'muted()' },
  template: `<ui-icon name="sparkles" [size]="12" /><span>{{ label() }}</span
    ><ng-content />`,
  styles: `
    :host {
      display: inline-flex;
      align-items: center;
      gap: var(--space-1);
      padding: calc(var(--space-1) / 2) var(--space-2);
      border: 1px solid var(--ai-border);
      border-radius: var(--radius-full);
      background: var(--ai-soft);
      color: var(--ai-text);
      font-size: var(--text-xs);
      font-weight: 600;
      line-height: 1.4;
      white-space: nowrap;
    }
    :host(.muted) {
      border-color: var(--border-subtle);
      background: var(--surface-sunken);
      color: var(--text-secondary);
    }
  `,
})
export class UiAiBadge {
  readonly label = input('AI');
  readonly muted = input(false);
}
