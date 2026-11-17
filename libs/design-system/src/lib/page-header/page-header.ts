import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { UiTilt } from '../tilt/tilt';

/**
 * Page title row of a module: the character's emblem on an island token, a
 * title, a subtitle and actions (`[uiPageActions]`). Set `data-character` on a
 * parent to apply the character theme. The token turns gently towards the
 * pointer while it moves over the header.
 */
@Component({
  selector: 'ui-page-header',
  changeDetection: ChangeDetectionStrategy.OnPush,
  hostDirectives: [UiTilt],
  template: `<span class="emblem ui-token" aria-hidden="true">{{
      emblem()
    }}</span>
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
      margin-bottom: var(--space-8);
      animation: ui-rise-in var(--duration-slow) var(--ease-out) both;
    }
    .emblem {
      --token-size: var(--space-16);
      --token-depth: 6px;
    }
    .text {
      flex: 1;
      min-width: 12rem;
    }
    .title {
      font-size: var(--text-3xl);
    }
    .subtitle {
      max-width: 68ch;
      margin: var(--space-1) 0 0;
      color: var(--text-secondary);
      text-wrap: pretty;
    }
    .actions {
      display: flex;
      flex-wrap: wrap;
      gap: var(--space-2);
    }
    /* Phones: a smaller token, so the title keeps its width. */
    @media (width <= 40rem) {
      :host {
        align-items: flex-start;
        gap: var(--space-3);
      }
      .emblem {
        --token-size: var(--space-12);
        --token-depth: 4px;
      }
      .title {
        font-size: var(--text-2xl);
      }
    }
  `,
})
export class UiPageHeader {
  readonly heading = input.required<string>();
  readonly subtitle = input('');
  /** A short glyph for the module's character until its avatar exists. */
  readonly emblem = input('🦕');
}
