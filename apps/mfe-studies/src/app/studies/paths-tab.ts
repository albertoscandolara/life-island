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
  PATH_LEVEL_HINTS,
  PATH_LEVEL_LABELS,
  PATH_START_LABELS,
  PATH_STARTS,
  SCOUT_RESOURCE_KIND_LABELS,
  STEP_KIND_LABELS,
  STEP_PACE_LABELS,
  STEP_STATUS_LABELS,
  STEP_STATUSES,
  STUDY_TOPIC_LABELS,
  type LearningPath,
  type PathOutlineRequest,
  type PathStart,
  type PathStatus,
  type ScoutResourceDto,
  type StepProgressDto,
  type StepStatus,
  type StudiesOverviewDto,
} from '@life-island/contracts';
import {
  UiAiBadge,
  UiAiPanel,
  UiAiStatus,
  UiBadge,
  UiButton,
  UiCard,
  UiConfirmDialog,
  UiDialog,
  UiEmptyState,
  UiIcon,
  UiProgressBar,
  UiTrail,
  type UiTrailStop,
  type UiTrailState,
} from '@life-island/design-system';
import type { Observable } from 'rxjs';
import { AiTool } from '@life-island/settings-ui';
import { StudiesApi } from '../api/studies-api';
import { PathEditor } from './path-editor';
import { ScoutPanel } from './scout-panel';
import {
  dateText,
  duration,
  errorText,
  safeUrl,
  textOrNull,
  today,
} from './labels';

interface BuilderAsk {
  subject: string;
  goal: string;
  start: PathStart;
}

/**
 * Your learning paths: the rail of the ones you added (and Add a topic), then
 * the one you picked as a trail of stages, "You are here" on the stage with
 * your next step. Done stages fold away, the current one is open.
 */
@Component({
  selector: 'studies-paths',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    AiTool,
    PathEditor,
    ScoutPanel,
    UiAiBadge,
    UiAiPanel,
    UiAiStatus,
    UiBadge,
    UiButton,
    UiCard,
    UiConfirmDialog,
    UiDialog,
    UiEmptyState,
    UiIcon,
    UiProgressBar,
    UiTrail,
  ],
  templateUrl: './paths-tab.html',
  styleUrls: ['./blocks.css', './paths-tab.css'],
})
export class PathsTab {
  private readonly api = inject(StudiesApi);

  readonly data = input.required<StudiesOverviewDto>();
  readonly pathId = input<string | null>(null);
  readonly selectPath = output<string>();
  readonly openFresh = output<void>();
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
  protected readonly addOpen = signal(false);
  protected readonly editorOpen = signal(false);
  /** The path the editor changes; null writes a new one. */
  protected readonly editing = signal<LearningPath | null>(null);
  protected readonly removeOpen = signal(false);
  protected readonly levelLabels = PATH_LEVEL_LABELS;
  protected readonly levelHints = PATH_LEVEL_HINTS;
  protected readonly starts = PATH_STARTS;
  protected readonly startLabels = PATH_START_LABELS;
  /** The path builder's form, and the draft it wrote for the editor. */
  protected readonly ask = signal<BuilderAsk>({
    subject: '',
    goal: '',
    start: 'some',
  });
  protected readonly drafting = signal(false);
  protected readonly draftError = signal<string | null>(null);
  protected readonly drafted = signal<PathOutlineRequest | null>(null);
  /** Stages you opened or folded yourself, by `<path>/<stage>`. */
  private readonly folds = signal(new Map<string, boolean>());

  protected readonly progressOf = computed(
    () => new Map(this.data().paths.map((p) => [p.pathId, p])),
  );
  protected readonly selected = computed<LearningPath | undefined>(
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
  protected readonly progress = computed(() => {
    const path = this.selected();
    return path ? this.progressOf().get(path.id) : undefined;
  });
  protected readonly stepOf = computed(
    () =>
      new Map<string, StepProgressDto>(
        (this.progress()?.steps ?? []).map((s) => [s.stepId, s]),
      ),
  );
  /** Each stage of the path on the trail: done, where you are, or ahead. */
  protected readonly stageStates = computed(() => {
    const states = new Map<string, UiTrailState>();
    const path = this.selected();
    if (!path) return states;
    const next = this.progress()?.nextStepId ?? null;
    for (const stage of path.stages) {
      const done = this.stageDone(stage.steps) === stage.steps.length;
      states.set(
        stage.id,
        stage.steps.some((s) => s.id === next)
          ? 'current'
          : done
            ? 'done'
            : 'ahead',
      );
    }
    return states;
  });
  protected readonly stops = computed<UiTrailStop[]>(() =>
    (this.selected()?.stages ?? []).map((stage) => ({
      id: stage.id,
      label: stage.title,
      detail: [
        stage.level ? PATH_LEVEL_LABELS[stage.level] : null,
        `${this.stageDone(stage.steps)} of ${stage.steps.length} steps`,
      ]
        .filter(Boolean)
        .join(' · '),
      state: this.stageStates().get(stage.id) ?? 'ahead',
    })),
  );

  /** Open: the stage you are on, unless you opened or folded one yourself. */
  protected stageOpen(stageId: string): boolean {
    const key = `${this.selected()?.id}/${stageId}`;
    return (
      this.folds().get(key) ?? this.stageStates().get(stageId) === 'current'
    );
  }

  protected fold(stageId: string, open: boolean): void {
    if (this.stageOpen(stageId) === open) return;
    const key = `${this.selected()?.id}/${stageId}`;
    this.folds.update((m) => new Map(m).set(key, open));
  }

  /** A stop on the trail opens its stage and brings it into view. */
  protected goToStage(stageId: string): void {
    this.fold(stageId, true);
    setTimeout(() =>
      document
        .getElementById(`studies-stage-${stageId}`)
        ?.scrollIntoView({ behavior: 'smooth', block: 'start' }),
    );
  }

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

  protected follow(pathId: string, status: PathStatus): void {
    this.run(
      'path',
      this.api.setPath(pathId, { status }),
      'Could not change the path.',
    );
  }

  /** Add a topic: a curated path, followed from today. */
  protected addTemplate(id: string): void {
    this.busy.set(`template:${id}`);
    this.api.addPath({ template: id }).subscribe({
      next: () => {
        this.busy.set(null);
        this.addOpen.set(false);
        this.selectPath.emit(id);
        this.changed.emit();
      },
      error: (error: unknown) => {
        this.busy.set(null);
        this.failed.emit(errorText(error, 'Could not add the path.'));
      },
    });
  }

  protected writeOwn(): void {
    this.addOpen.set(false);
    this.editing.set(null);
    this.drafted.set(null);
    this.editorOpen.set(true);
  }

  /** The path builder drafts the path; it opens in the editor, not saved. */
  protected draftPath(): void {
    const ask = this.ask();
    if (ask.subject.trim().length < 2) {
      this.draftError.set(
        'Name the topic first, e.g. "Rust for web services".',
      );
      return;
    }
    this.drafting.set(true);
    this.draftError.set(null);
    this.api
      .draftPath({
        subject: ask.subject.trim(),
        goal: ask.goal.trim() || null,
        start: ask.start,
      })
      .subscribe({
        next: ({ outline }) => {
          this.drafting.set(false);
          this.addOpen.set(false);
          this.editing.set(null);
          this.drafted.set(outline);
          this.editorOpen.set(true);
        },
        error: (error: unknown) => {
          this.drafting.set(false);
          this.draftError.set(
            errorText(error, 'The path builder could not draft the path.'),
          );
        },
      });
  }

  protected setAsk(patch: Partial<BuilderAsk>): void {
    this.ask.update((a) => ({ ...a, ...patch }));
  }

  protected edit(path: LearningPath): void {
    this.drafted.set(null);
    this.editing.set(path);
    this.editorOpen.set(true);
  }

  protected onSaved(id: string): void {
    this.selectPath.emit(id);
    this.changed.emit();
  }

  protected remove(pathId: string): void {
    this.busy.set('remove');
    this.api.removePath(pathId).subscribe({
      next: () => {
        this.busy.set(null);
        this.removeOpen.set(false);
        const other = this.paths().find((p) => p.id !== pathId);
        if (other) this.selectPath.emit(other.id);
        this.changed.emit();
      },
      error: (error: unknown) => {
        this.busy.set(null);
        this.removeOpen.set(false);
        this.failed.emit(errorText(error, 'Could not remove the path.'));
      },
    });
  }

  protected setTarget(pathId: string, value: string): void {
    const status = this.progress()?.status ?? 'following';
    this.run(
      'path',
      this.api.setPath(pathId, {
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
