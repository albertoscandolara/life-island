import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import {
  UiIcon,
  UiPageHeader,
  type UiIconName,
} from '@life-island/design-system';

/** Archie's zone: the two parts of Settings, side by side as tabs. */
@Component({
  selector: 'settings-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, RouterLinkActive, RouterOutlet, UiIcon, UiPageHeader],
  host: { 'data-character': 'archie', class: 'settings' },
  template: `
    <ui-page-header
      emblem="⚙️"
      heading="Settings"
      subtitle="Every setting of the island in one place, and every tool that uses AI: what one use costs, the request it sends, and a switch to turn it off."
    />
    <nav class="tabs" aria-label="Settings">
      @for (tab of tabs; track tab.path) {
        <a
          class="tab"
          [routerLink]="tab.path"
          routerLinkActive="tab--on"
          ariaCurrentWhenActive="page"
        >
          <ui-icon [name]="tab.icon" [size]="18" /> {{ tab.label }}
        </a>
      }
    </nav>
    <router-outlet />
  `,
  styleUrl: './settings.css',
})
export class SettingsPage {
  protected readonly tabs: { path: string; label: string; icon: UiIconName }[] =
    [
      { path: 'app', label: 'App settings', icon: 'sliders' },
      { path: 'ai-tools', label: 'AI tools', icon: 'sparkles' },
    ];
}
