import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import type { StudiesOverviewDto } from '@life-island/contracts';
import {
  UiAlert,
  UiButton,
  UiInfoGuide,
  UiInfoTopic,
  UiPageHeader,
  UiProgressBar,
} from '@life-island/design-system';
import {
  LiDelta,
  LiNeedsYou,
  LiTabs,
  urlTab,
  type LiTab,
} from '@life-island/records-ui';
import { StudiesApi } from '../api/studies-api';
import { CoursesTab } from './courses-tab';
import { duration, errorText, hours } from './labels';
import { OverviewTab } from './overview-tab';
import { PathsTab } from './paths-tab';
import { PlatformsTab } from './platforms-tab';
import { studiesTiles } from './tiles';

export const STUDIES_VIEWS = ['overview', 'paths', 'courses'] as const;
export type StudiesTab = (typeof STUDIES_VIEWS)[number];

/**
 * The tabs Studies once had: a link to `?tab=coach` or `?tab=platforms`
 * (from the Agenda or a bookmark) opens the block it now lives in.
 */
const OLD_TABS: Record<string, { view: StudiesTab; block: string }> = {
  coach: { view: 'overview', block: 'studies-week' },
  platforms: { view: 'courses', block: 'studies-platforms' },
};

/**
 * Studies (Iggy) by priority: what needs you, four tiles, then the tabs.
 * Overview answers "what do I study now?", Paths "where am I on the road?",
 * Courses and exams "what did I sign up for, and what does it cost?".
 */
@Component({
  selector: 'studies-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CoursesTab,
    LiDelta,
    LiNeedsYou,
    LiTabs,
    OverviewTab,
    PathsTab,
    PlatformsTab,
    UiAlert,
    UiButton,
    UiInfoGuide,
    UiInfoTopic,
    UiPageHeader,
    UiProgressBar,
  ],
  host: { 'data-character': 'iggy', class: 'studies' },
  templateUrl: './studies-page.html',
  styleUrl: './studies-page.css',
})
export class StudiesPage {
  private readonly api = inject(StudiesApi);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  /** While the resource scout scans, the page looks again every few seconds. */
  private poll: ReturnType<typeof setTimeout> | null = null;
  private pendingJump: string | null = null;

  protected readonly overview = signal<StudiesOverviewDto | null>(null);
  protected readonly error = signal<string | null>(null);
  protected readonly tab = urlTab(STUDIES_VIEWS, 'overview');
  protected readonly guideOpen = signal(false);
  protected readonly guideTopic = signal('');
  protected readonly duration = duration;
  protected readonly hours = hours;
  /** The path shown in Paths. */
  protected readonly pathId = signal<string | null>(
    this.route.snapshot.queryParamMap.get('path'),
  );

  protected readonly tiles = computed(() => {
    const data = this.overview();
    return data ? studiesTiles(data) : null;
  });

  protected readonly tabs = computed<LiTab<StudiesTab>[]>(() => {
    const data = this.overview();
    const scout = data
      ? data.scout.proposals.length +
        data.scout.resources.filter(
          (r) => r.status === 'suggested' || r.outdated,
        ).length
      : 0;
    const courses = data
      ? data.reminders.filter(
          (r) =>
            r.severity !== 'info' &&
            (r.kind === 'subscription' ||
              r.kind === 'exam' ||
              r.kind === 'certification'),
        ).length
      : 0;
    return [
      { id: 'overview', label: 'Overview', icon: 'home' },
      {
        id: 'paths',
        label: 'Paths',
        icon: 'layers',
        count: scout || undefined,
      },
      {
        id: 'courses',
        label: 'Courses and exams',
        icon: 'check',
        count: courses || undefined,
      },
    ];
  });

  constructor() {
    this.load();
    inject(DestroyRef).onDestroy(() => {
      if (this.poll) clearTimeout(this.poll);
    });
    // `?tab=coach` and `?tab=platforms` (old tabs) open their block.
    this.route.queryParamMap.pipe(takeUntilDestroyed()).subscribe((query) => {
      const old = OLD_TABS[query.get('tab') ?? ''];
      if (old) this.jump(old.view, old.block);
      const path = query.get('path');
      if (path) this.pathId.set(path);
    });
    // `?guide=scout` opens the guide, from a link anywhere on the island.
    this.route.queryParamMap.pipe(takeUntilDestroyed()).subscribe((query) => {
      const topic = query.get('guide');
      if (topic) {
        this.guideTopic.set(topic);
        this.guideOpen.set(true);
      }
    });
  }

  protected setTab(tab: StudiesTab): void {
    this.tab.set(tab, { path: tab === 'paths' ? this.pathId() : null });
  }

  protected openPath(pathId: string): void {
    this.pathId.set(pathId);
    this.tab.set('paths', { path: pathId });
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

  protected showGuide(topic: string): void {
    this.guideTopic.set(topic);
    this.guideOpen.set(true);
  }

  /** A closed guide leaves the URL, so a reload does not open it again. */
  protected onGuideClosed(): void {
    if (!this.route.snapshot.queryParamMap.get('guide')) return;
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { guide: null },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }

  /** Opens a tab and brings one of its blocks into view once it is drawn. */
  protected jump(view: StudiesTab, block: string): void {
    if (this.tab() !== view) this.tab.set(view);
    this.pendingJump = block;
    if (this.overview()) this.scrollToPending();
  }

  private scrollToPending(): void {
    const id = this.pendingJump;
    if (!id) return;
    setTimeout(() => {
      const target = document.getElementById(id);
      if (!target) return;
      this.pendingJump = null;
      target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }

  protected load(): void {
    this.api.overview().subscribe({
      next: (overview) => {
        this.overview.set(overview);
        this.error.set(null);
        this.scrollToPending();
        if (this.poll) clearTimeout(this.poll);
        this.poll =
          overview.scout.lastScan?.status === 'running'
            ? setTimeout(() => this.load(), 5000)
            : null;
      },
      error: (error: unknown) =>
        this.error.set(errorText(error, 'Could not load your studies.')),
    });
  }

  protected failed(message: string): void {
    this.error.set(message);
  }
}
