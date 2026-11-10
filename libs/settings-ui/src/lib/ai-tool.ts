import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  signal,
} from '@angular/core';
import { formatUsd } from '@life-island/contracts';
import { Router } from '@angular/router';
import { UiAiBadge, UiButton, UiIcon } from '@life-island/design-system';
import { AiToolInfo } from './ai-tool-info';
import {
  AI_TOOLS_SETTINGS_URL,
  aiToolSettingsLink,
  SettingsApi,
  type AiToolView,
} from './settings-api';

/**
 * Shown next to every tool that calls an AI model, where the tool lives: what
 * one use costs, its on/off switch (the same switch as in Settings → AI tools)
 * and an info button with the request it sends. Every new AI tool gets one
 * (docs/guides/ai-tools.md):
 *
 * ```html
 * <li-ai-tool toolId="work.market-check" />
 * ```
 *
 * `compact` drops the switch's label, for a tight row. The badge links to the
 * tool in Settings → AI tools (`settingsLink` false on that page itself).
 */
@Component({
  selector: 'li-ai-tool',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [UiAiBadge, UiButton, UiIcon, AiToolInfo],
  host: { class: 'li-ai-tool' },
  template: `
    @if (view(); as v) {
      @if (settingsLink()) {
        <a
          class="badge-link"
          [href]="link()"
          [attr.aria-label]="v.definition.name + ' in Settings: ' + badge(v)"
          title="Open in Settings → AI tools"
          (click)="openSettings($event)"
        >
          <ui-ai-badge [label]="badge(v)" [muted]="!v.active" />
        </a>
      } @else {
        <ui-ai-badge
          [label]="badge(v)"
          [muted]="!v.active"
          [attr.title]="
            v.costIsEstimate
              ? 'Estimated cost per ' + v.definition.unit
              : 'Average cost per ' + v.definition.unit + ' over its real uses'
          "
        />
      }
      <label class="switch" [class.switch--compact]="compact()">
        <input
          type="checkbox"
          role="switch"
          [checked]="v.state?.enabled ?? v.definition.defaultEnabled"
          [disabled]="!v.state || saving()"
          [attr.aria-label]="v.definition.name + ': use AI'"
          (change)="toggle($any($event.target).checked)"
        />
        @if (!compact()) {
          <span>{{
            (v.state?.enabled ?? v.definition.defaultEnabled) ? 'On' : 'Off'
          }}</span>
        }
      </label>
      <button
        uiButton
        type="button"
        variant="ghost"
        size="sm"
        [iconOnly]="true"
        [attr.aria-label]="
          'About ' + v.definition.name + ': model, prompt and cost'
        "
        title="Model, prompt and cost"
        (click)="infoOpen.set(true)"
      >
        <ui-icon name="info" [size]="16" />
      </button>
      @if (error()) {
        <span class="error" role="alert">{{ error() }}</span>
      }
      <li-ai-tool-info [toolId]="toolId()" [(open)]="infoOpen" />
    }
  `,
  styles: `
    :host {
      display: inline-flex;
      align-items: center;
      flex-wrap: wrap;
      gap: var(--space-1);
      vertical-align: middle;
    }
    .badge-link {
      display: inline-flex;
      border-radius: var(--radius-full);
      text-decoration: none;
    }
    .badge-link:hover {
      filter: brightness(0.97);
    }
    .badge-link:focus-visible {
      outline: none;
      box-shadow: var(--focus-ring);
    }
    .switch {
      display: inline-flex;
      align-items: center;
      gap: var(--space-1);
      font-size: var(--text-xs);
      color: var(--text-secondary);
      cursor: pointer;
    }
    .switch input {
      appearance: none;
      position: relative;
      inline-size: 2rem;
      block-size: 1.125rem;
      margin: 0;
      border-radius: var(--radius-full);
      background: var(--border-strong);
      cursor: pointer;
      transition: background 120ms ease;
    }
    .switch input::after {
      content: '';
      position: absolute;
      inset-block-start: 2px;
      inset-inline-start: 2px;
      inline-size: 0.875rem;
      block-size: 0.875rem;
      border-radius: var(--radius-full);
      background: var(--surface-card);
      transition: transform 120ms ease;
    }
    .switch input:checked {
      background: var(--ai-accent);
    }
    .switch input:checked::after {
      transform: translateX(0.875rem);
    }
    .switch input:focus-visible {
      outline: none;
      box-shadow: var(--focus-ring);
    }
    .switch input:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }
    .error {
      color: var(--danger);
      font-size: var(--text-xs);
    }
    @media (prefers-reduced-motion: reduce) {
      .switch input,
      .switch input::after {
        transition: none;
      }
    }
  `,
})
export class AiTool {
  private readonly api = inject(SettingsApi);
  private readonly router = inject(Router, { optional: true });
  private readonly settingsUrl = inject(AI_TOOLS_SETTINGS_URL);

  readonly toolId = input.required<string>();
  readonly compact = input(false);
  /** The badge opens the tool in Settings; off on Settings → AI tools itself. */
  readonly settingsLink = input(true);

  protected readonly link = computed(() =>
    aiToolSettingsLink(this.settingsUrl, this.toolId()),
  );

  /** Inside the island the router opens Settings without reloading the page. */
  protected openSettings(event: MouseEvent): void {
    const url = this.link();
    if (
      !this.router ||
      !url.startsWith('/') ||
      event.ctrlKey ||
      event.metaKey ||
      event.shiftKey ||
      event.button !== 0
    )
      return;
    event.preventDefault();
    void this.router.navigateByUrl(url);
  }

  protected readonly view = computed(() => this.api.tool(this.toolId()));
  protected readonly infoOpen = signal(false);
  protected readonly saving = signal(false);
  protected readonly error = signal<string | null>(null);

  protected badge(view: AiToolView): string {
    if (!view.active) return `AI · ${view.offReason}`;
    return `AI · ${view.costIsEstimate ? '~' : ''}${formatUsd(view.costUsd)} / ${view.definition.unit}`;
  }

  protected async toggle(enabled: boolean): Promise<void> {
    this.saving.set(true);
    this.error.set(null);
    try {
      await this.api.setAiTool(this.toolId(), enabled);
    } catch {
      this.error.set('Could not save. Try again.');
      this.api.overview.reload();
    } finally {
      this.saving.set(false);
    }
  }
}
