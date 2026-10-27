import { Component } from '@angular/core';
import { RouterLink, RouterOutlet } from '@angular/router';
import { UiIcon } from '@life-island/design-system';
import { environment } from '../environments/environment';

/** Life Island: the host for everything that shows and uses your data. */
@Component({
  imports: [RouterOutlet, RouterLink, UiIcon],
  selector: 'app-root',
  templateUrl: './app.html',
  styleUrl: './app.css',
})
export class App {
  protected readonly documentsUrl = environment.documentsUrl;
}
