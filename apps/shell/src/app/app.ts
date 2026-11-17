import { Component, inject } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { AuthState } from '@life-island/auth-ui';
import { UiIcon, UiThemeToggle } from '@life-island/design-system';
import { environment } from '../environments/environment';
import { LastArea } from './last-area';

/** Life Island: the host for everything that shows and uses your data. */
@Component({
  imports: [RouterOutlet, RouterLink, RouterLinkActive, UiIcon, UiThemeToggle],
  selector: 'app-root',
  templateUrl: './app.html',
  styleUrl: './app.css',
})
export class App {
  protected readonly documentsUrl = environment.documentsUrl;
  protected readonly auth = inject(AuthState);

  constructor() {
    inject(LastArea).start();
  }
}
