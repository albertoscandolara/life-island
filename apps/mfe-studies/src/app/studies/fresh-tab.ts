import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import {
  learningPath,
  pathStep,
  SCOUT_RESOURCE_KIND_LABELS,
  type LearningPath,
  type OutlineChangeDto,
  type OutlineDecision,
  type ScoutResourceDto,
  type StudiesOverviewDto,
} from '@life-island/contracts';
import {
  UiAiPanel,
  UiAiStatus,
  UiButton,
  UiCard,
  UiEmptyState,
  UiIcon,
} from '@life-island/design-system';
import { AiTool } from '@life-island/settings-ui';
import type { Observable } from 'rxjs';
import { StudiesApi } from '../api/studies-api';
import { dateText, errorText, safeUrl } from './labels';

/** What the scout found for one of your paths. */
export interface FreshGroup {
  path: LearningPath;
  changes: OutlineChangeDto[];
  /** New resources, by step in path order. */
  steps: { id: string; title: string; resources: ScoutResourceDto[] }[];
  outdated: ScoutResourceDto[];
}

/** The scout's findings grouped by path (catalogue order), newest resources first. */
export function freshGroups(data: StudiesOverviewDto): FreshGroup[] {
  const { resources, proposals } = data.scout;
  return data.catalogue.flatMap((path) => {
    const mine = resources.filter((r) => r.pathId === path.id);
    const changes = proposals.filter((p) => p.pathId === path.id);
    const steps = path.stages
      .flatMap((stage) => stage.steps)
      .map((step) => ({
        id: step.id,
        title: step.title,
        resources: mine
          .filter((r) => r.stepId === step.id && r.status === 'suggested')
          .sort((a, b) => b.foundAt.localeCompare(a.foundAt)),
      }))
      .filter((s) => s.resources.length);
    const outdated = mine.filter((r) => r.status === 'pinned' && r.outdated);
    return changes.length || steps.length || outdated.length
      ? [{ path, changes, steps, outdated }]
      : [];
  });
}

/**
 * Fresh resources: everything the resource scout found across your paths,
 * waiting for you. What changed in your topics (steps to add or retire),
 * new resources to pin or dismiss, pinned ones it found outdated. Above,
 * which paths it watches and when it scans next.
 */
@Component({
  selector: 'studies-fresh',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    AiTool,
    UiAiPanel,
    UiAiStatus,
    UiButton,
    UiCard,
    UiEmptyState,
    UiIcon,
  ],
  templateUrl: './fresh-tab.html',
  styleUrls: ['./blocks.css', './fresh-tab.css'],
})
export class FreshTab {
  private readonly api = inject(StudiesApi);

  readonly data = input.required<StudiesOverviewDto>();
  readonly changed = output<void>();
  readonly failed = output<string>();
  readonly openPath = output<string>();

  protected readonly dateText = dateText;
  protected readonly safeUrl = safeUrl;
  protected readonly kinds = SCOUT_RESOURCE_KIND_LABELS;
  protected readonly busy = signal<string | null>(null);

  protected readonly scout = computed(() => this.data().scout);
  protected readonly groups = computed(() => freshGroups(this.data()));
  protected readonly watching = computed(() =>
    this.scout().watched.filter((w) => w.watching),
  );
  /** The next scan the scout has planned: the watched path due first. */
  protected readonly next = computed(() => {
    const due = this.watching()
      .filter((w) => w.nextScanOn)
      .sort((a, b) => (a.nextScanOn ?? '').localeCompare(b.nextScanOn ?? ''));
    const first = due[0];
    return first
      ? {
          name: this.nameOf(first.pathId),
          on: first.nextScanOn as string,
        }
      : null;
  });
  protected readonly running = computed(() => {
    const last = this.scout().lastScan;
    return last?.status === 'running' ? this.nameOf(last.pathId) : null;
  });

  protected nameOf(pathId: string): string {
    return learningPath(pathId, this.data().catalogue)?.name ?? pathId;
  }

  protected stageTitle(path: LearningPath, stageId: string): string {
    return path.stages.find((s) => s.id === stageId)?.title ?? stageId;
  }

  protected stepTitle(change: OutlineChangeDto): string {
    return (
      change.title ??
      pathStep(change.stepId, this.data().catalogue)?.title ??
      change.stepId
    );
  }

  private run(key: string, call: Observable<unknown>, failure: string): void {
    this.busy.set(key);
    call.subscribe({
      next: () => {
        this.busy.set(null);
        this.changed.emit();
      },
      error: (error: unknown) => {
        this.busy.set(null);
        this.failed.emit(errorText(error, failure));
      },
    });
  }

  protected decide(change: OutlineChangeDto, decision: OutlineDecision): void {
    this.run(
      change.id,
      this.api.decideChange(change.id, { decision }),
      'Could not save your decision.',
    );
  }

  /** Pin a resource (or keep a flagged one), or dismiss it for good. */
  protected keep(
    resource: ScoutResourceDto,
    status: 'pinned' | 'dismissed',
  ): void {
    this.run(
      resource.id,
      this.api.decideResource(resource.id, { status }),
      'Could not save your choice.',
    );
  }
}
