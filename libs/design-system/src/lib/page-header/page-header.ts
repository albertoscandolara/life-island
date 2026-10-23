import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/**
 * Page title row of a module: an emblem in the character's accent, a title, a
 * subtitle and actions (`[uiPageActions]`). Set `data-character` on a parent
 * to apply the character theme.
 */
@Component({
  selector: 'ui-page-header',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<span class="emblem" aria-hidden="true">{{ emblem() }}</span>
    <div class="text">
      <h1 class="title">{{ heading() }}</h1>
      @if (subtitle()) {
        <p class="subtitle">{{ subtitle() }}</p>
      }
    </div>
    <div class="actions"><ng-content select="[uiPageActions]" /></div>`,
  styles: `
    :host {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: var(--space-4);
      margin-bottom: var(--space-6);
    }
    .emblem {
      display: grid;
      place-items: center;
      width: var(--space-12);
      height: var(--space-12);
      border-radius: var(--radius-md);
      background: var(--accent-soft);
      color: var(--accent);
      font-size: var(--text-2xl);
    }
    .text {
      flex: 1;
      min-width: 12rem;
    }
    .title {
      font-size: var(--text-2xl);
    }
    .subtitle {
      margin: var(--space-1) 0 0;
      color: var(--text-secondary);
    }
    .actions {
      display: flex;
      gap: var(--space-2);
    }
  `,
})
export class UiPageHeader {
  readonly heading = input.required<string>();
  readonly subtitle = input('');
  /** A short glyph for the module's character until its avatar exists. */
  readonly emblem = input('🦕');
}
