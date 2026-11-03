import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { UiBadge, UiIcon } from '@life-island/design-system';
import { environment } from '../../environments/environment';
import { IslandView } from '../island/island-view';
import { ISLAND_MODULES, type IslandModule } from './modules';

/**
 * The island hub: the 3D island (loaded only when it can be shown) and, under
 * it, one card per area so every area is one click away. With reduced motion
 * the cards are the whole hub (architecture.md, 3D rules).
 */
@Component({
  selector: 'app-hub-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, UiBadge, UiIcon, IslandView],
  templateUrl: './hub-page.html',
  styleUrl: './hub-page.css',
})
export class HubPage {
  private readonly router = inject(Router);

  protected readonly modules = ISLAND_MODULES;
  protected readonly documentsUrl = environment.documentsUrl;
  protected readonly show3d =
    typeof matchMedia === 'function' &&
    !matchMedia('(prefers-reduced-motion: reduce)').matches;

  protected open(module: IslandModule): void {
    if (module.path) void this.router.navigateByUrl(module.path);
  }
}
