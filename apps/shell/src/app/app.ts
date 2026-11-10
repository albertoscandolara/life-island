import { Component, inject } from '@angular/core';
import { RouterLink, RouterOutlet } from '@angular/router';
import { UiIcon, UiThemeToggle } from '@life-island/design-system';
import { environment } from '../environments/environment';
import { LastArea } from './last-area';

/** Life Island: the host for everything that shows and uses your data. */
@Component({
  imports: [RouterOutlet, RouterLink, UiIcon, UiThemeToggle],
  selector: 'app-root',
  templateUrl: './app.html',
  styleUrl: './app.css',
})
export class App {
  protected readonly documentsUrl = environment.documentsUrl;

  constructor() {
    inject(LastArea).start();
  }
}
