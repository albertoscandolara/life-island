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
  SCOUT_RESOURCE_KIND_LABELS,
  STEP_KIND_LABELS,
  STEP_PACE_LABELS,
  STEP_STATUS_LABELS,
  STEP_STATUSES,
  STUDY_TOPIC_LABELS,
  type PathStatus,
  type ScoutResourceDto,
  type StepProgressDto,
  type StepStatus,
  type StudiesOverviewDto,
} from '@life-island/contracts';
import {
  UiAiBadge,
  UiBadge,
  UiButton,
  UiCard,
  UiIcon,
  UiProgressBar,
} from '@life-island/design-system';
import type { Observable } from 'rxjs';
import { StudiesApi } from '../api/studies-api';
import { ScoutPanel } from './scout-panel';
import {
  dateText,
  duration,
  errorText,
  safeUrl,
  textOrNull,
  today,
} from './labels';

/**
 * The learning paths: each one with its stages and steps, the resources to
 * use, your progress, your target date and the pace you are at.
 */
@Component({
  selector: 'studies-paths',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    ScoutPanel,
    UiAiBadge,
    UiBadge,
    UiButton,
    UiCard,
    UiIcon,
    UiProgressBar,
  ],
  templateUrl: './paths-tab.html',
  styleUrls: ['./blocks.css', './paths-tab.css'],
})
export class PathsTab {
  private readonly api = inject(StudiesApi);

  readonly data = input.required<StudiesOverviewDto>();
  readonly pathId = input<string | null>(null);
  readonly selectPath = output<string>();
  readonly changed = output<void>();
  readonly failed = output<string>();

  /** The paths with the outline changes you accepted. */
  protected readonly paths = computed(() => this.data().catalogue);
  protected readonly resourceKinds = SCOUT_RESOURCE_KIND_LABELS;
  protected readonly paceLabels = STEP_PACE_LABELS;
  protected readonly kindLabels = STEP_KIND_LABELS;
  protected readonly statusLabels = STEP_STATUS_LABELS;
  protected readonly statuses = STEP_STATUSES;
  protected readonly topicLabels = STUDY_TOPIC_LABELS;
  protected readonly dateText = dateText;
  protected readonly duration = duration;
  protected readonly safeUrl = safeUrl;
  protected readonly quick = [25, 50, 90];
  protected readonly busy = signal<string | null>(null);
  /** The step whose notes are open. */
  protected readonly notesOpen = signal<string | null>(null);

  protected readonly progressOf = computed(
    () => new Map(this.data().paths.map((p) => [p.pathId, p])),
  );
  protected readonly selected = computed(
    () =>
      this.paths().find((p) => p.id === this.pathId()) ??
      this.paths().find(
        (p) => this.progressOf().get(p.id)?.status === 'following',
      ) ??
      this.paths()[0],
  );
  /** What the resource scout found for each step: pinned first. */
  protected readonly scouted = computed(() => {
    const byStep = new Map<string, ScoutResourceDto[]>();
    for (const r of this.data().scout.resources) {
      const list = byStep.get(r.stepId) ?? [];
      list.push(r);
      byStep.set(r.stepId, list);
    }
    for (const list of byStep.values())
      list.sort(
        (a, b) =>
          Number(b.status === 'pinned') - Number(a.status === 'pinned') ||
          b.foundAt.localeCompare(a.foundAt),
      );
    return byStep;
  });
  protected readonly progress = computed(() =>
    this.progressOf().get(this.selected().id)!,
  );
  protected readonly stepOf = computed(
    () =>
      new Map<string, StepProgressDto>(
        this.progress().steps.map((s) => [s.stepId, s]),
      ),
  );

  protected percent(pathId: string): number {
    const p = this.progressOf().get(pathId);
    return p ? Math.round((p.hoursDone / p.hoursTotal) * 100) : 0;
  }

  protected stageDone(stageSteps: readonly { id: string }[]): number {
    return stageSteps.filter((s) => this.stepOf().get(s.id)?.status === 'done')
      .length;
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

  protected follow(status: PathStatus | null): void {
    this.run(
      'path',
      this.api.setPath(this.selected().id, { status }),
      'Could not change the path.',
    );
  }

  protected setTarget(value: string): void {
    const status = this.progress().status ?? 'following';
    this.run(
      'path',
      this.api.setPath(this.selected().id, {
        status,
        targetOn: value || null,
      }),
      'Could not save the target date.',
    );
  }

  protected setStatus(stepId: string, status: StepStatus): void {
    if (this.stepOf().get(stepId)?.status === status) return;
    this.run(
      stepId,
      this.api.setStep(stepId, { status }),
      'Could not save the step.',
    );
  }

  protected saveNotes(stepId: string, value: string): void {
    const step = this.stepOf().get(stepId);
    const notes = textOrNull(value);
    if ((step?.notes ?? null) === notes) return;
    this.run(
      stepId,
      this.api.setStep(stepId, { status: step?.status ?? 'todo', notes }),
      'Could not save the notes.',
    );
  }

  protected logTime(stepId: string, minutes: number): void {
    this.run(
      stepId,
      this.api.addSession({ date: today(), minutes, stepId }),
      'Could not log the time.',
    );
  }

  /** Pin a resource the scout found (or keep a flagged one), or dismiss it for good. */
  protected decide(
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
