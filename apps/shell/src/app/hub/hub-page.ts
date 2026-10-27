import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { UiBadge, UiIcon } from '@life-island/design-system';
import { environment } from '../../environments/environment';
import { ISLAND_MODULES } from './modules';

/** The 2D hub: one card per module. The 3D island replaces it later (architecture.md, 3D rules). */
@Component({
  selector: 'app-hub-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, UiBadge, UiIcon],
  templateUrl: './hub-page.html',
  styleUrl: './hub-page.css',
})
export class HubPage {
  protected readonly modules = ISLAND_MODULES;
  protected readonly documentsUrl = environment.documentsUrl;
}
