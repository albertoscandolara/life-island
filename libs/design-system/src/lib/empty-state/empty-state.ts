import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { UiIcon, type UiIconName } from '../icon/icon';

@Component({
  selector: 'ui-empty-state',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [UiIcon],
  template: `<span class="icon ui-token ui-token--soft"
      ><ui-icon [name]="icon()" [size]="28"
    /></span>
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
    /* An island token that rests on the page: the soft one, so it never reads as an action. */
    .icon {
      --token-size: var(--space-16);
      margin-bottom: var(--space-3);
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
