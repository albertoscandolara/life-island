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
      margin-bottom: var(--space-8);
      animation: ui-rise-in var(--duration-slow) var(--ease-out) both;
    }
    .emblem {
      display: grid;
      place-items: center;
      position: relative;
      width: var(--space-16);
      height: var(--space-16);
      border-radius: var(--radius-lg);
      background: var(--accent-gradient);
      box-shadow: var(--accent-glow);
      font-size: var(--text-3xl);
      animation: emblem-float 6s ease-in-out infinite;
    }
    /* A glossy highlight on the emblem. */
    .emblem::after {
      content: '';
      position: absolute;
      inset: 0;
      border-radius: inherit;
      background: linear-gradient(
        160deg,
        color-mix(in srgb, var(--surface-card) 35%, transparent),
        transparent 55%
      );
    }
    @keyframes emblem-float {
      50% {
        transform: translateY(-3px) rotate(-2deg);
      }
    }
    .text {
      flex: 1;
      min-width: 12rem;
    }
    .title {
      font-size: var(--text-3xl);
    }
    .subtitle {
      margin: var(--space-1) 0 0;
      color: var(--text-secondary);
    }
    .actions {
      display: flex;
      flex-wrap: wrap;
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
