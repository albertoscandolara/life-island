import { HttpClient } from '@angular/common/http';
import {
  ChangeDetectionStrategy,
  Component,
  inject,
  signal,
} from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import type { PeopleAttentionDto } from '@life-island/contracts';
import { UiBadge, UiIcon, type UiTone } from '@life-island/design-system';
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
  private readonly http = inject(HttpClient);

  /** What needs you in each area that says so, by module id. */
  protected readonly attention = signal<
    Record<string, { text: string; tone: UiTone }>
  >({});

  constructor() {
    for (const module of this.modules)
      if (module.attentionUrl)
        this.http.get<PeopleAttentionDto>(module.attentionUrl).subscribe({
          next: (counts) => {
            const badge = attentionBadge(counts);
            if (badge)
              this.attention.update((all) => ({ ...all, [module.id]: badge }));
          },
          // An area that cannot be reached simply shows no badge.
          error: () => undefined,
        });
  }

  protected readonly modules = ISLAND_MODULES;
  protected readonly documentsUrl = environment.documentsUrl;
  protected readonly show3d =
    typeof matchMedia === 'function' &&
    !matchMedia('(prefers-reduced-motion: reduce)').matches;

  protected open(module: IslandModule): void {
    if (module.path) void this.router.navigateByUrl(module.path);
  }
}

/** "2 expired · 1 to review": the most urgent tone wins; nothing when all is fine. */
export function attentionBadge(
  counts: PeopleAttentionDto,
): { text: string; tone: UiTone } | null {
  const parts = [
    counts.expired ? `${counts.expired} expired` : null,
    counts.expiring ? `${counts.expiring} expiring` : null,
    counts.toReview ? `${counts.toReview} to review` : null,
  ].filter(Boolean);
  if (!parts.length) return null;
  return {
    text: parts.join(' · '),
    tone: counts.expired ? 'danger' : counts.expiring ? 'warning' : 'info',
  };
}
