import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  model,
  output,
  signal,
  untracked,
} from '@angular/core';
import {
  PATH_LEVEL_LABELS,
  PATH_LEVELS,
  STEP_KIND_LABELS,
  STUDY_TOPIC_LABELS,
  STUDY_TOPICS,
  type LearningPath,
  type PathOutlineRequest,
} from '@life-island/contracts';
import {
  UiAiBadge,
  UiButton,
  UiDialog,
  UiIcon,
} from '@life-island/design-system';
import { StudiesApi } from '../api/studies-api';
import { errorText } from './labels';
import {
  blankDraft,
  blankStage,
  blankStep,
  draftOutline,
  draftProblem,
  moved,
  outlineDraft,
  pathDraft,
  type PathDraft,
  type StageDraft,
  type StepDraft,
} from './path-outline';

/**
 * Write a path of your own, or change one you have: its card, its stages
 * and their steps. A step you keep keeps your progress on it.
 */
@Component({
  selector: 'studies-path-editor',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [UiAiBadge, UiButton, UiDialog, UiIcon],
  templateUrl: './path-editor.html',
  styleUrl: './path-editor.css',
})
export class PathEditor {
  private readonly api = inject(StudiesApi);

  readonly open = model(false);
  /** The path to change; null writes a new one. */
  readonly path = input<LearningPath | null>(null);
  /** A new path's start: the path builder's draft. */
  readonly drafted = input<PathOutlineRequest | null>(null);
  readonly saved = output<string>();

  protected readonly topics = STUDY_TOPICS;
  protected readonly topicLabels = STUDY_TOPIC_LABELS;
  protected readonly kinds = ['learn', 'build', 'practice'] as const;
  protected readonly kindLabels = STEP_KIND_LABELS;
  protected readonly levels = PATH_LEVELS;
  protected readonly levelLabels = PATH_LEVEL_LABELS;
  protected readonly draft = signal<PathDraft>(blankDraft());
  protected readonly saving = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly tried = signal(false);
  protected readonly problem = computed(() => draftProblem(this.draft()));

  constructor() {
    // A fresh draft each time the editor opens.
    effect(() => {
      if (!this.open()) return;
      const path = this.path();
      const drafted = this.drafted();
      untracked(() => {
        this.draft.set(
          path
            ? pathDraft(path)
            : drafted
              ? outlineDraft(drafted)
              : blankDraft(),
        );
        this.error.set(null);
        this.tried.set(false);
      });
    });
  }

  protected set<K extends keyof PathDraft>(key: K, value: PathDraft[K]): void {
    this.draft.update((d) => ({ ...d, [key]: value }));
  }

  protected setStage(i: number, patch: Partial<StageDraft>): void {
    this.draft.update((d) => ({
      ...d,
      stages: d.stages.map((s, k) => (k === i ? { ...s, ...patch } : s)),
    }));
  }

  protected setStep(i: number, j: number, patch: Partial<StepDraft>): void {
    const stage = this.draft().stages[i];
    this.setStage(i, {
      steps: stage.steps.map((s, k) => (k === j ? { ...s, ...patch } : s)),
    });
  }

  protected addStage(): void {
    this.draft.update((d) => ({ ...d, stages: [...d.stages, blankStage()] }));
  }

  protected removeStage(i: number): void {
    this.draft.update((d) => ({
      ...d,
      stages: d.stages.filter((_, k) => k !== i),
    }));
  }

  protected moveStage(i: number, by: number): void {
    this.draft.update((d) => ({ ...d, stages: moved(d.stages, i, by) }));
  }

  protected addStep(i: number): void {
    this.setStage(i, { steps: [...this.draft().stages[i].steps, blankStep()] });
  }

  protected removeStep(i: number, j: number): void {
    this.setStage(i, {
      steps: this.draft().stages[i].steps.filter((_, k) => k !== j),
    });
  }

  protected moveStep(i: number, j: number, by: number): void {
    this.setStage(i, { steps: moved(this.draft().stages[i].steps, j, by) });
  }

  protected save(): void {
    this.tried.set(true);
    if (this.problem()) return;
    const outline = draftOutline(this.draft());
    const path = this.path();
    this.saving.set(true);
    this.error.set(null);
    const done = (id: string) => {
      this.saving.set(false);
      this.open.set(false);
      this.saved.emit(id);
    };
    const failed = (error: unknown) => {
      this.saving.set(false);
      this.error.set(errorText(error, 'Could not save the path.'));
    };
    if (path)
      this.api.editPath(path.id, outline).subscribe({
        next: () => done(path.id),
        error: failed,
      });
    else
      this.api.addPath({ outline }).subscribe({
        next: ({ id }) => done(id),
        error: failed,
      });
  }

  protected value(event: Event): string {
    return (event.target as HTMLInputElement).value;
  }
}
