import {
  ChangeDetectionStrategy,
  Component,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
} from '@angular/core';
import type { DreamsOverviewDto } from '@life-island/contracts';
import { UiButton, UiCard } from '@life-island/design-system';
import { dateText, errorText } from '@life-island/records-ui';
import { DreamsApi } from '../api/dreams-api';

const SERVICE = 'svc-dreams';

export const MOODS = [
  { value: 1, label: '😣', name: 'Rough' },
  { value: 2, label: '😕', name: 'Meh' },
  { value: 3, label: '😐', name: 'OK' },
  { value: 4, label: '🙂', name: 'Good' },
  { value: 5, label: '😄', name: 'Great' },
] as const;

/**
 * Your week (moved here from Goals & habits): five minutes on Sunday about
 * every dream at once, what went well, where you got stuck, what comes
 * next, and the weeks before.
 */
@Component({
  selector: 'dreams-weekly-review',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [UiButton, UiCard],
  templateUrl: './weekly-review.html',
  styleUrl: './weekly-review.css',
})
export class WeeklyReview {
  private readonly api = inject(DreamsApi);

  readonly data = input.required<DreamsOverviewDto>();
  readonly changed = output<void>();
  readonly failed = output<string>();

  protected readonly dateText = dateText;
  protected readonly moods = MOODS;
  protected readonly mood = signal<number | null>(null);
  protected readonly wins = signal('');
  protected readonly stuck = signal('');
  protected readonly next = signal('');
  protected readonly saving = signal(false);
  protected readonly saved = signal(false);
  private filledFor: string | null = null;

  constructor() {
    // Fill the form with this week's review once, so a reload never
    // overwrites what you are typing.
    effect(() => {
      const d = this.data();
      if (untracked(() => this.filledFor) === d.weekStart) return;
      this.filledFor = d.weekStart;
      const current = d.reviews.find((r) => r.weekStart === d.weekStart);
      this.mood.set(current?.mood ?? null);
      this.wins.set(current?.wins ?? '');
      this.stuck.set(current?.stuck ?? '');
      this.next.set(current?.next ?? '');
    });
  }

  protected moodLabel(mood: number | null): string {
    return MOODS.find((m) => m.value === mood)?.label ?? '';
  }

  protected save(): void {
    this.saving.set(true);
    this.saved.set(false);
    this.api
      .saveWeeklyReview({
        weekStart: this.data().weekStart,
        mood: this.mood(),
        wins: this.wins(),
        stuck: this.stuck(),
        next: this.next(),
      })
      .subscribe({
        next: () => {
          this.saving.set(false);
          this.saved.set(true);
          this.changed.emit();
        },
        error: (error: unknown) => {
          this.saving.set(false);
          this.failed.emit(
            errorText(error, 'Could not save the week.', SERVICE),
          );
        },
      });
  }
}
