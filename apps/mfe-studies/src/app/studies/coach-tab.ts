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
  pathOfStep,
  type StudiesOverviewDto,
  type StudyPlanDto,
} from '@life-island/contracts';
import {
  UiAiPanel,
  UiAiStatus,
  UiButton,
  UiCard,
  UiIcon,
} from '@life-island/design-system';
import { AiTool } from '@life-island/settings-ui';
import { StudiesApi } from '../api/studies-api';
import { dateText, duration, errorText, numberOrNull } from './labels';

/** The study coach (AI tool studies.study-coach): your week, planned from what you recorded. */
@Component({
  selector: 'studies-coach',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [AiTool, UiAiPanel, UiAiStatus, UiButton, UiCard, UiIcon],
  templateUrl: './coach-tab.html',
  styleUrls: ['./blocks.css', './coach-tab.css'],
})
export class CoachTab {
  private readonly api = inject(StudiesApi);

  readonly data = input.required<StudiesOverviewDto>();
  readonly changed = output<void>();
  readonly failed = output<string>();
  readonly openPath = output<string>();

  protected readonly question = signal('');
  protected readonly hours = signal('');
  protected readonly asking = signal(false);
  protected readonly status = signal<'idle' | 'done' | 'error'>('idle');
  protected readonly shownId = signal<string | null>(null);
  protected readonly duration = duration;
  protected readonly dateText = dateText;

  protected readonly shown = computed<StudyPlanDto | null>(
    () =>
      this.data().plans.find((p) => p.id === this.shownId()) ??
      this.data().plans[0] ??
      null,
  );

  protected pathOf(stepId: string): string | null {
    return stepId
      ? (pathOfStep(stepId, this.data().catalogue)?.id ?? null)
      : null;
  }

  protected totalMinutes(plan: StudyPlanDto): number {
    return plan.output.schedule.reduce((sum, s) => sum + s.minutes, 0);
  }

  protected ask(): void {
    this.asking.set(true);
    this.status.set('idle');
    this.api
      .writePlan({
        question: this.question().trim() || null,
        hours: numberOrNull(this.hours()),
      })
      .subscribe({
        next: (plan) => {
          this.asking.set(false);
          this.status.set('done');
          this.shownId.set(plan.id);
          this.question.set('');
          this.changed.emit();
        },
        error: (error: unknown) => {
          this.asking.set(false);
          this.status.set('error');
          this.failed.emit(errorText(error, 'Could not write the plan.'));
        },
      });
  }

  protected remove(plan: StudyPlanDto): void {
    this.api.removePlan(plan.id).subscribe({
      next: () => {
        this.shownId.set(null);
        this.changed.emit();
      },
      error: (error: unknown) =>
        this.failed.emit(errorText(error, 'Could not remove the plan.')),
    });
  }
}
