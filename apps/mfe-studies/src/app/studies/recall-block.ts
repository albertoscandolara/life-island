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
  RECALL_INTERVALS_DAYS,
  type RecallResult,
  type StudiesOverviewDto,
} from '@life-island/contracts';
import {
  UiAiBadge,
  UiAiPanel,
  UiButton,
  UiIcon,
} from '@life-island/design-system';
import { AiTool } from '@life-island/settings-ui';
import { StudiesApi } from '../api/studies-api';
import { dateText, errorText } from './labels';

/**
 * Recall: the questions of the steps you finished that came back today, one
 * at a time. Think of the answer, show it, and say whether you had it: a
 * right one comes back after a week, then a month; a missed one, tomorrow.
 */
@Component({
  selector: 'studies-recall',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [AiTool, UiAiBadge, UiAiPanel, UiButton, UiIcon],
  templateUrl: './recall-block.html',
  styleUrls: ['./blocks.css', './recall-block.css'],
})
export class RecallBlock {
  private readonly api = inject(StudiesApi);

  readonly data = input.required<StudiesOverviewDto>();
  readonly changed = output<void>();
  readonly failed = output<string>();

  protected readonly dateText = dateText;
  protected readonly intervals = RECALL_INTERVALS_DAYS;
  /** Cards answered in this sitting, so the next one shows at once. */
  private readonly answered = signal<ReadonlySet<string>>(new Set());
  protected readonly revealed = signal(false);
  protected readonly busy = signal(false);
  protected readonly gotToday = signal(0);

  protected readonly recall = computed(() => this.data().recall);
  protected readonly left = computed(() =>
    this.recall().due.filter((c) => !this.answered().has(c.id)),
  );
  protected readonly card = computed(() => this.left()[0] ?? null);
  protected readonly total = computed(() => this.recall().due.length);
  protected readonly position = computed(
    () => this.total() - this.left().length + 1,
  );
  /** "Agentic engineering · Model Context Protocol". */
  protected readonly context = computed(() => {
    const c = this.card();
    if (!c) return '';
    const catalogue = this.data().catalogue;
    return [
      learningPath(c.pathId, catalogue)?.name,
      pathStep(c.stepId, catalogue)?.title,
    ]
      .filter(Boolean)
      .join(' · ');
  });

  protected answer(result: RecallResult): void {
    const c = this.card();
    if (!c || this.busy()) return;
    this.busy.set(true);
    this.api.answerRecall(c.id, { result }).subscribe({
      next: () => {
        this.busy.set(false);
        this.revealed.set(false);
        if (result === 'got') this.gotToday.update((n) => n + 1);
        this.answered.update((s) => new Set([...s, c.id]));
        if (!this.left().length) this.changed.emit();
      },
      error: (error: unknown) => {
        this.busy.set(false);
        this.failed.emit(errorText(error, 'Could not save your answer.'));
      },
    });
  }
}
