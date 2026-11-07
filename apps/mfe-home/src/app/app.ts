import { Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { UiThemeToggle } from '@life-island/design-system';

/** The Home module running on its own (inside Life Island the shell hosts it). */
@Component({
  imports: [RouterOutlet, UiThemeToggle],
  selector: 'home-root',
  template: `
    <header class="standalone-bar">
      <span>Life Island · Houses (standalone)</span>
      <ui-theme-toggle />
    </header>
    <main class="standalone-page"><router-outlet /></main>
  `,
  styles: `
    .standalone-bar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: var(--space-3) var(--space-4);
      border-bottom: 1px solid var(--border-subtle);
      color: var(--text-secondary);
    }
    .standalone-page {
      max-width: 80rem;
      margin: 0 auto;
      padding: var(--space-6) var(--space-4);
    }
  `,
})
export class App {}
