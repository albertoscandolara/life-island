import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  model,
  signal,
  untracked,
} from '@angular/core';
import {
  TEACH_BACK_VERDICT_LABELS,
  type PathStep,
  type TeachBackDto,
} from '@life-island/contracts';
import {
  UiAiPanel,
  UiAiStatus,
  UiButton,
  UiDialog,
  UiIcon,
} from '@life-island/design-system';
import { AiTool } from '@life-island/settings-ui';
import { StudiesApi } from '../api/studies-api';
import { errorText } from './labels';

/** The shortest explanation teach-back reads. */
export const TEACH_BACK_MIN = 80;

/**
 * Teach-back: explain a step in your own words, as to a colleague, and
 * Claude says what holds, what is missing and the one thing to do next.
 */
@Component({
  selector: 'studies-teach-back',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [AiTool, UiAiPanel, UiAiStatus, UiButton, UiDialog, UiIcon],
  templateUrl: './teach-back.html',
  styleUrl: './teach-back.css',
})
export class TeachBack {
  private readonly api = inject(StudiesApi);

  readonly open = model(false);
  readonly step = input<PathStep | null>(null);
  /** Whether teach-back can review now (key, switches, budget). */
  readonly ai = input(false);

  protected readonly min = TEACH_BACK_MIN;
  protected readonly verdicts = TEACH_BACK_VERDICT_LABELS;
  protected readonly text = signal('');
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly review = signal<TeachBackDto | null>(null);
  protected readonly short = computed(
    () => this.text().trim().length < TEACH_BACK_MIN,
  );

  constructor() {
    // A fresh page for each step you open it on.
    effect(() => {
      this.step();
      if (!this.open()) return;
      untracked(() => {
        this.text.set('');
        this.review.set(null);
        this.error.set(null);
      });
    });
  }

  protected send(): void {
    const step = this.step();
    if (!step || this.short() || this.busy()) return;
    this.busy.set(true);
    this.error.set(null);
    this.api.teachBack(step.id, { explanation: this.text().trim() }).subscribe({
      next: (review) => {
        this.busy.set(false);
        this.review.set(review);
      },
      error: (error: unknown) => {
        this.busy.set(false);
        this.error.set(errorText(error, 'Claude could not review it.'));
      },
    });
  }

  protected again(): void {
    this.review.set(null);
  }
}
