import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { UiIcon, type UiIconName } from '../icon/icon';

@Component({
  selector: 'ui-empty-state',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [UiIcon],
  template: `<span class="icon"><ui-icon [name]="icon()" [size]="28" /></span>
    <p class="heading">{{ heading() }}</p>
    <ng-content />`,
  styles: `
    :host {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: var(--space-2);
      padding: var(--space-10) var(--space-4);
      color: var(--text-muted);
      text-align: center;
    }
    .icon {
      display: grid;
      place-items: center;
      width: var(--space-16);
      height: var(--space-16);
      margin-bottom: var(--space-2);
      border-radius: var(--radius-full);
      background: var(--accent-soft);
      color: var(--accent);
      animation: ui-rise-in var(--duration-slow) var(--ease-out) both;
    }
    .heading {
      margin: 0;
      color: var(--text-primary);
      font-weight: 600;
    }
  `,
})
export class UiEmptyState {
  readonly heading = input.required<string>();
  readonly icon = input<UiIconName>('inbox');
}
