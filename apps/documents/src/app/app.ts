import { Component } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { UiIcon, UiThemeToggle } from '@life-island/design-system';
import { ReclassificationBanner } from './reclassification/reclassification-banner';
import { environment } from '../environments/environment';

/** The documents app: load files on one side, review what was parsed on the other. */
@Component({
  imports: [
    ReclassificationBanner,
    RouterOutlet,
    RouterLink,
    RouterLinkActive,
    UiIcon,
    UiThemeToggle,
  ],
  selector: 'app-root',
  templateUrl: './app.html',
  styleUrl: './app.css',
})
export class App {
  protected readonly shellUrl = environment.shellUrl;
}
