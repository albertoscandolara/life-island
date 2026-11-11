import { HttpClient } from '@angular/common/http';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
} from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import {
  DEADLINE_SOURCES,
  HIDDEN_AREAS_SETTING,
  ISLAND_VIEW_SETTING,
  type AgendaEntryDto,
  type AgendaUpcomingDto,
  type PeopleAttentionDto,
} from '@life-island/contracts';
import { BrowserSettings, hiddenAreas } from '@life-island/settings-ui';
import { UiBadge, UiIcon, type UiTone } from '@life-island/design-system';
import { environment } from '../../environments/environment';
import { IslandView } from '../island/island-view';
import { ISLAND_MODULES, type IslandModule } from './modules';

/**
 * The island hub: the 3D island (loaded only when it can be shown) and, under
 * it, one card per area so every area is one click away. With reduced motion,
 * or "Cards only" in Settings → Island, the cards are the whole hub
 * (architecture.md, 3D rules). Areas you turned off in Settings are left out;
 * Settings itself always stays.
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
  private readonly settings = inject(BrowserSettings);

  /** What needs you in each area that says so, by module id. */
  protected readonly attention = signal<
    Record<string, { text: string; tone: UiTone }>
  >({});

  /** The next dates from every area (the Agenda), for the "Coming up" strip. */
  protected readonly upcoming = signal<readonly AgendaEntryDto[]>([]);

  constructor() {
    this.http
      .get<AgendaUpcomingDto>('/api/agenda/upcoming', {
        params: { days: 14 },
      })
      .subscribe({
        next: (data) => this.upcoming.set(data.entries.slice(0, 6)),
        // Without the Agenda the strip simply does not show.
        error: () => undefined,
      });
    for (const module of ISLAND_MODULES)
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

  /** The areas you use: all of them but the ones turned off in Settings. */
  protected readonly modules = computed(() => {
    const hidden = hiddenAreas(this.settings.value(HIDDEN_AREAS_SETTING));
    return ISLAND_MODULES.filter(
      (module) => module.id === 'settings' || !hidden.has(module.id),
    );
  });
  protected readonly hiddenCount = computed(
    () => ISLAND_MODULES.length - this.modules().length,
  );
  protected readonly documentsUrl = environment.documentsUrl;
  private readonly motion =
    typeof matchMedia === 'function' &&
    !matchMedia('(prefers-reduced-motion: reduce)').matches;
  protected readonly show3d = computed(
    () => this.motion && this.settings.value(ISLAND_VIEW_SETTING) !== 'cards',
  );

  /** The strip shows while the Agenda is one of your areas. */
  protected readonly comingUp = computed(() =>
    this.modules().some((module) => module.id === 'agenda')
      ? this.upcoming()
      : [],
  );

  protected emblem(module: string): string {
    return (
      DEADLINE_SOURCES.find((source) => source.module === module)?.emblem ??
      (module === 'agenda' ? '🗓️' : '📌')
    );
  }

  protected when(entry: AgendaEntryDto): string {
    return whenText(entry.daysLeft);
  }

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

/** "3 days late", "Today", "Tomorrow", "In 5 days". */
export function whenText(daysLeft: number): string {
  if (daysLeft < -1) return `${-daysLeft} days late`;
  if (daysLeft === -1) return '1 day late';
  if (daysLeft === 0) return 'Today';
  if (daysLeft === 1) return 'Tomorrow';
  return `In ${daysLeft} days`;
}
