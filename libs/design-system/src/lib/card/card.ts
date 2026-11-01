import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/** A surface with a border and padding; `heading` adds a title row, `[uiCardActions]` content sits beside it. */
@Component({
  selector: 'ui-card',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `@if (heading()) {
      <header class="card__header">
        <h2 class="card__heading">{{ heading() }}</h2>
        <ng-content select="[uiCardActions]" />
      </header>
    }
    <ng-content />`,
  styles: `
    :host {
      display: block;
      padding: var(--space-5) var(--space-6);
      border: 1px solid var(--border-subtle);
      border-radius: var(--card-radius);
      background: var(--surface-card);
      box-shadow: var(--shadow-card);
      transition:
        box-shadow var(--duration-normal) var(--ease-out),
        border-color var(--duration-normal) var(--ease-out);
    }
    .card__header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: var(--space-3);
      margin-bottom: var(--space-4);
    }
    .card__heading {
      display: flex;
      align-items: center;
      gap: var(--space-2);
      font-size: var(--text-lg);
    }
    /* A short accent bar marks each card title. */
    .card__heading::before {
      content: '';
      width: 4px;
      height: 1.1em;
      border-radius: var(--radius-full);
      background: var(--accent-gradient);
    }
  `,
})
export class UiCard {
  readonly heading = input('');
}
