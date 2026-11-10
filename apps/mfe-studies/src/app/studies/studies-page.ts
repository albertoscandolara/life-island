import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
} from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import type { StudiesOverviewDto } from '@life-island/contracts';
import {
  UiAlert,
  UiButton,
  UiIcon,
  UiPageHeader,
  type UiIconName,
} from '@life-island/design-system';
import { StudiesApi } from '../api/studies-api';
import { CoachTab } from './coach-tab';
import { CoursesTab } from './courses-tab';
import { errorText } from './labels';
import { OverviewTab } from './overview-tab';
import { PathsTab } from './paths-tab';
import { PlatformsTab } from './platforms-tab';

export type StudiesTab =
  'overview' | 'paths' | 'courses' | 'platforms' | 'coach';

const TABS: { id: StudiesTab; label: string; icon: UiIconName }[] = [
  { id: 'overview', label: 'This week', icon: 'calendar' },
  { id: 'paths', label: 'Learning paths', icon: 'layers' },
  { id: 'courses', label: 'Courses and exams', icon: 'check' },
  { id: 'platforms', label: 'Training platforms', icon: 'external' },
  { id: 'coach', label: 'Study coach', icon: 'sparkles' },
];

/**
 * Studies (Iggy): your week of study against your goal and what needs you,
 * the learning paths with your progress, courses, exams and certifications,
 * the training platforms you use and the study coach.
 */
@Component({
  selector: 'studies-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CoachTab,
    CoursesTab,
    OverviewTab,
    PathsTab,
    PlatformsTab,
    UiAlert,
    UiButton,
    UiIcon,
    UiPageHeader,
  ],
  host: { 'data-character': 'iggy', class: 'studies' },
  templateUrl: './studies-page.html',
  styleUrl: './studies-page.css',
})
export class StudiesPage {
  private readonly api = inject(StudiesApi);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  protected readonly tabs = TABS;
  protected readonly overview = signal<StudiesOverviewDto | null>(null);
  protected readonly error = signal<string | null>(null);
  protected readonly tab = signal<StudiesTab>(this.initialTab());
  /** The path shown in Learning paths. */
  protected readonly pathId = signal<string | null>(
    this.route.snapshot.queryParamMap.get('path'),
  );

  protected readonly reminderCount = computed(
    () =>
      this.overview()?.reminders.filter((r) => r.severity !== 'info').length ??
      0,
  );

  constructor() {
    this.load();
  }

  private initialTab(): StudiesTab {
    const tab = this.route.snapshot.queryParamMap.get('tab');
    return TABS.some((t) => t.id === tab) ? (tab as StudiesTab) : 'overview';
  }

  protected setTab(tab: StudiesTab): void {
    this.tab.set(tab);
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: {
        tab: tab === 'overview' ? null : tab,
        path: tab === 'paths' ? this.pathId() : null,
      },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }

  protected openPath(pathId: string): void {
    this.pathId.set(pathId);
    this.setTab('paths');
  }

  protected selectPath(pathId: string): void {
    this.pathId.set(pathId);
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { path: pathId },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }

  protected load(): void {
    this.api.overview().subscribe({
      next: (overview) => {
        this.overview.set(overview);
        this.error.set(null);
      },
      error: (error: unknown) =>
        this.error.set(errorText(error, 'Could not load your studies.')),
    });
  }

  protected failed(message: string): void {
    this.error.set(message);
  }
}
