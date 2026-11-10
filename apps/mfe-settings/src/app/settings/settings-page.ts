import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
} from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { AI_TOOLS, APP_SETTINGS } from '@life-island/contracts';
import {
  UiIcon,
  UiInput,
  UiPageHeader,
  type UiIconName,
} from '@life-island/design-system';
import {
  searchWords,
  settingMatches,
  SettingsSearch,
  toolMatches,
} from './search';

/**
 * Archie's zone: the two parts of Settings, side by side as tabs, with one
 * search box over both (each tab says how many of its entries match).
 */
@Component({
  selector: 'settings-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    RouterLink,
    RouterLinkActive,
    RouterOutlet,
    UiIcon,
    UiInput,
    UiPageHeader,
  ],
  host: { 'data-character': 'archie', class: 'settings' },
  template: `
    <ui-page-header
      emblem="⚙️"
      heading="Settings"
      subtitle="Every setting of the island in one place, and every tool that uses AI: what one use costs, the request it sends, and a switch to turn it off."
    />
    <div class="toolbar">
      <nav class="tabs" aria-label="Settings">
        @for (tab of tabs(); track tab.path) {
          <a
            class="tab"
            [routerLink]="tab.path"
            routerLinkActive="tab--on"
            ariaCurrentWhenActive="page"
          >
            <ui-icon [name]="tab.icon" [size]="18" /> {{ tab.label }}
            @if (tab.hits !== null) {
              <span class="tab__hits">{{ tab.hits }}</span>
            }
          </a>
        }
      </nav>
      <label class="search">
        <ui-icon name="search" [size]="16" />
        <span class="ui-visually-hidden">Search settings</span>
        <input
          uiInput
          type="search"
          placeholder="Search settings"
          [value]="search.query()"
          (input)="search.query.set($any($event.target).value)"
        />
      </label>
    </div>
    <router-outlet />
  `,
  styleUrl: './settings.css',
})
export class SettingsPage {
  protected readonly search = inject(SettingsSearch);

  protected readonly tabs = computed(() => {
    const words = searchWords(this.search.query());
    const searching = words.length > 0;
    const tabs: {
      path: string;
      label: string;
      icon: UiIconName;
      hits: number | null;
    }[] = [
      {
        path: 'app',
        label: 'App settings',
        icon: 'sliders',
        hits: searching
          ? APP_SETTINGS.filter((s) => settingMatches(s, words)).length
          : null,
      },
      {
        path: 'ai-tools',
        label: 'AI tools',
        icon: 'sparkles',
        hits: searching
          ? AI_TOOLS.filter((t) => toolMatches(t, words)).length
          : null,
      },
    ];
    return tabs;
  });
}
