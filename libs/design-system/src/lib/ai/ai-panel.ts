import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { UiIcon } from '../icon/icon';
import type { UiAiState } from './ai-status';

/**
 * The container of every AI feature, in any module: a card with a quiet
 * violet border and header, the sparkle mark before the title, an eyebrow that
 * says what it is, and a slot for the tool's control (cost, switch, info:
 * `<li-ai-tool uiAiPanelActions>`). While a request runs, a thin line moves
 * under the header. The body is the tool's own: forms, results, layout.
 *
 * ```html
 * <ui-ai-panel heading="Career feedback" [state]="asking() ? 'working' : 'idle'">
 *   <li-ai-tool uiAiPanelActions toolId="work.career-feedback" />
 *   …
 * </ui-ai-panel>
 * ```
 *
 * `kind`: `tool` where you start a request ("AI tool"), `result` for what a
 * model wrote ("Written by AI"). `offline` drops the AI colour for a result
 * that Life Island's own rules wrote instead (the tool was off or had no key).
 */
@Component({
  selector: 'ui-ai-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [UiIcon],
  host: {
    '[class.offline]': 'offline()',
    '[attr.data-state]': 'state()',
    '[attr.aria-busy]': "state() === 'working' || null",
  },
  template: `<header class="head">
      <span class="mark" aria-hidden="true"
        ><ui-icon name="sparkles" [size]="18"
      /></span>
      <div class="titles">
        <span class="eyebrow">{{ eyebrowText() }}</span>
        <h2 class="heading">{{ heading() }}</h2>
      </div>
      <div class="actions"><ng-content select="[uiAiPanelActions]" /></div>
    </header>
    @if (state() === 'working') {
      <div class="progress" aria-hidden="true"><span></span></div>
    }
    <div class="body"><ng-content /></div>`,
  styles: `
    :host {
      display: block;
      overflow: hidden;
      border: 1px solid var(--ai-border);
      border-radius: var(--card-radius);
      background: var(--surface-card);
      box-shadow: var(--shadow-card);
    }
    :host(.offline) {
      border-color: var(--border-subtle);
    }
    .head {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: var(--space-3);
      padding: var(--space-4) var(--space-6);
      border-bottom: 1px solid var(--ai-border);
      background: var(--ai-soft);
    }
    :host(.offline) .head {
      border-bottom-color: var(--border-subtle);
      background: var(--surface-sunken);
    }
    .mark {
      display: grid;
      place-items: center;
      flex-shrink: 0;
      width: var(--space-8);
      height: var(--space-8);
      border: 1px solid var(--ai-border);
      border-radius: var(--radius-md);
      background: var(--surface-card);
      color: var(--ai-accent);
    }
    :host(.offline) .mark {
      border-color: var(--border-subtle);
      color: var(--text-secondary);
    }
    .titles {
      flex: 1 1 12rem;
      min-width: 0;
    }
    .eyebrow {
      display: block;
      color: var(--ai-text);
      font-size: var(--text-xs);
      font-weight: 600;
      letter-spacing: 0.04em;
      text-transform: uppercase;
    }
    :host(.offline) .eyebrow {
      color: var(--text-secondary);
    }
    .heading {
      margin: 0;
      font-size: var(--text-lg);
    }
    .actions {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: var(--space-2);
    }
    .actions:empty {
      display: none;
    }
    .progress {
      position: relative;
      height: 2px;
      overflow: hidden;
      background: var(--ai-soft);
    }
    .progress span {
      position: absolute;
      inset: 0 auto 0 0;
      width: 30%;
      background: var(--ai-accent);
      animation: ai-progress 1.6s ease-in-out infinite;
    }
    @keyframes ai-progress {
      from {
        transform: translateX(-100%);
      }
      to {
        transform: translateX(340%);
      }
    }
    .body {
      padding: var(--space-5) var(--space-6);
    }
    @media (prefers-reduced-motion: reduce) {
      .progress span {
        width: 100%;
        animation: none;
        opacity: 0.5;
      }
    }
  `,
})
export class UiAiPanel {
  readonly heading = input.required<string>();
  readonly kind = input<'tool' | 'result'>('tool');
  /** Overrides the eyebrow ("AI tool", "Written by AI"). */
  readonly eyebrow = input('');
  readonly state = input<UiAiState>('idle');
  readonly offline = input(false);

  protected eyebrowText(): string {
    if (this.eyebrow()) return this.eyebrow();
    if (this.offline()) return "Life Island's own rules";
    return this.kind() === 'result' ? 'Written by AI' : 'AI tool';
  }
}
