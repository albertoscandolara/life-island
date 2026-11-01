import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { UiThemeService } from './theme';

/**
 * A round button that switches between the light and dark theme, with a
 * sun that sets into a moon. Put it in an app's top bar: `<ui-theme-toggle />`.
 */
@Component({
  selector: 'ui-theme-toggle',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<button
    type="button"
    class="toggle"
    [class.toggle--dark]="dark()"
    [attr.aria-label]="
      dark() ? 'Switch to light theme' : 'Switch to dark theme'
    "
    [attr.title]="dark() ? 'Light theme' : 'Dark theme'"
    (click)="toggle($event)"
  >
    <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
      <mask id="ui-theme-toggle-mask">
        <rect width="24" height="24" fill="white" />
        <circle class="toggle__bite" cx="26" cy="2" r="7" fill="black" />
      </mask>
      <g mask="url(#ui-theme-toggle-mask)">
        <circle class="toggle__core" cx="12" cy="12" r="5" />
      </g>
      <g class="toggle__rays">
        <path
          d="M12 1.5v2 M12 20.5v2 M1.5 12h2 M20.5 12h2 M4.6 4.6l1.4 1.4 M18 18l1.4 1.4 M4.6 19.4 6 18 M18 6l1.4-1.4"
        />
      </g>
    </svg>
  </button>`,
  styles: `
    :host {
      display: inline-flex;
    }
    .toggle {
      display: grid;
      place-items: center;
      width: var(--control-height);
      height: var(--control-height);
      padding: 0;
      border: 1px solid var(--border-subtle);
      border-radius: var(--radius-full);
      background: var(--surface-card);
      color: var(--text-secondary);
      cursor: pointer;
      transition:
        color var(--duration-fast) var(--ease-out),
        border-color var(--duration-fast) var(--ease-out),
        transform var(--duration-fast) var(--ease-out);
    }
    .toggle:hover {
      border-color: var(--border-strong);
      color: var(--accent);
    }
    .toggle:active {
      transform: scale(0.92);
    }
    svg {
      overflow: visible;
    }
    .toggle__core {
      fill: currentColor;
      transform-origin: center;
      transition: transform var(--duration-slow) var(--ease-spring);
    }
    .toggle__bite {
      transition: transform var(--duration-slow) var(--ease-out);
    }
    .toggle__rays {
      stroke: currentColor;
      stroke-width: 2;
      stroke-linecap: round;
      transform-origin: center;
      transition:
        transform var(--duration-slow) var(--ease-out),
        opacity var(--duration-normal) var(--ease-out);
    }
    /* Dark: the sun grows into a crescent and its rays fold away. */
    .toggle--dark .toggle__core {
      transform: scale(1.55);
    }
    .toggle--dark .toggle__bite {
      transform: translate(-11px, 7px);
    }
    .toggle--dark .toggle__rays {
      opacity: 0;
      transform: rotate(-45deg) scale(0.5);
    }
  `,
})
export class UiThemeToggle {
  private readonly themes = inject(UiThemeService);
  protected readonly dark = () => this.themes.theme() === 'dark';

  protected toggle(event: MouseEvent): void {
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    this.themes.toggle({
      x: rect.left + rect.width / 2,
      y: rect.top + rect.height / 2,
    });
  }
}
