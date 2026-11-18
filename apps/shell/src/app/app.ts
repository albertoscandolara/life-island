import { Component, inject, signal, viewChild } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { AuthState } from '@life-island/auth-ui';
import { UiIcon, UiThemeToggle } from '@life-island/design-system';
import { environment } from '../environments/environment';
import { LastArea } from './last-area';
import { QuickAdd } from './quick-add/quick-add';
import { shortcutLabel } from './search/search';
import { SearchDialog } from './search/search-dialog';

/** Life Island: the host for everything that shows and uses your data. */
@Component({
  imports: [
    RouterOutlet,
    RouterLink,
    RouterLinkActive,
    UiIcon,
    UiThemeToggle,
    QuickAdd,
    SearchDialog,
  ],
  host: { '(document:keydown)': 'onKey($event)' },
  selector: 'app-root',
  templateUrl: './app.html',
  styleUrl: './app.css',
})
export class App {
  protected readonly documentsUrl = environment.documentsUrl;
  protected readonly auth = inject(AuthState);
  protected readonly searching = signal(false);
  protected readonly shortcut = shortcutLabel();
  protected readonly quickAdd = viewChild(QuickAdd);

  constructor() {
    inject(LastArea).start();
  }

  /** Ctrl+K (⌘K on a Mac), or "/" outside a text box, opens search. */
  protected onKey(event: KeyboardEvent): void {
    if (!this.auth.user() || this.searching()) return;
    const target = event.target as HTMLElement | null;
    const typing = !!target?.closest(
      'input, textarea, select, [contenteditable="true"]',
    );
    const ctrlK =
      (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k';
    if (ctrlK || (event.key === '/' && !typing && !event.ctrlKey)) {
      event.preventDefault();
      this.searching.set(true);
    }
  }
}
