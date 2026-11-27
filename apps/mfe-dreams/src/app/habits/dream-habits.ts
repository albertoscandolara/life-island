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
  isoAddDays,
  isoWeekStart,
  type DreamsOverviewDto,
  type HabitDto,
} from '@life-island/contracts';
import {
  UiButton,
  UiCalendarHeatmap,
  UiCard,
  UiEmptyState,
  UiIcon,
} from '@life-island/design-system';
import {
  LiRecordDialog,
  RecordEditor,
  dayText,
  errorText,
  type LiField,
} from '@life-island/records-ui';
import { DreamsApi } from '../api/dreams-api';

const SERVICE = 'svc-dreams';

/**
 * The habits you repeat, for a dream or for their own sake (moved here from
 * Goals & habits): a tick a day for the last week, this week against the
 * target, the streak, and the last thirteen weeks as a calendar.
 */
@Component({
  selector: 'dreams-habits',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    LiRecordDialog,
    UiButton,
    UiCalendarHeatmap,
    UiCard,
    UiEmptyState,
    UiIcon,
  ],
  templateUrl: './dream-habits.html',
  styleUrl: './dream-habits.css',
})
export class DreamHabits {
  private readonly api = inject(DreamsApi);

  readonly data = input.required<DreamsOverviewDto>();
  /** Only the habits of this dream; all of them when null. */
  readonly dreamId = input<string | null>(null);
  readonly changed = output<void>();
  readonly failed = output<string>();

  protected readonly dayText = dayText;
  protected readonly ticked = (v: number) => (v ? 'Done' : 'Not ticked');

  /** Ticks shown at once, before the service confirms them. */
  private readonly pending = signal<Record<string, boolean>>({});

  protected readonly editor = new RecordEditor(
    this.api,
    'habits',
    () => this.changed.emit(),
    SERVICE,
  );

  protected readonly habits = computed(() => {
    const id = this.dreamId();
    const all = this.data().habits;
    return id ? all.filter((h) => h.dreamId === id) : all;
  });

  protected readonly fields = computed<LiField[]>(() => [
    {
      key: 'title',
      label: 'Habit',
      type: 'text',
      required: true,
      wide: true,
      placeholder: 'Walk 30 minutes, read 10 pages…',
    },
    {
      key: 'perWeek',
      label: 'Days a week',
      type: 'number',
      required: true,
      min: 1,
      max: 7,
    },
    {
      key: 'dreamId',
      label: 'For the dream',
      type: 'select',
      emptyLabel: 'None, just for me',
      options: this.data()
        .dreams.filter((d) => d.status !== 'let-go')
        .map((d) => ({ value: d.id, label: d.title })),
    },
    { key: 'active', label: 'Active', type: 'checkbox' },
  ]);

  /** The last seven days, oldest first, for the tick grid. */
  protected readonly days = computed(() => {
    const today = this.data().today;
    return Array.from({ length: 7 }, (_, i) => isoAddDays(today, i - 6));
  });

  /** Each active habit over the last 13 weeks: the days ticked, and the weeks at target. */
  protected readonly calendars = computed(() => {
    const today = this.data().today;
    const from = isoAddDays(isoWeekStart(today), -7 * 12);
    return this.habits()
      .filter((h) => h.active)
      .map((h) => {
        const days = h.checked.filter((d) => d >= from);
        let weeks = 0;
        for (let start = from; start <= today; start = isoAddDays(start, 7)) {
          const end = isoAddDays(start, 6);
          if (days.filter((d) => d >= start && d <= end).length >= h.perWeek)
            weeks++;
        }
        return {
          habit: h,
          from,
          to: today,
          values: Object.fromEntries(days.map((d) => [d, 1])),
          days: days.length,
          weeks,
        };
      });
  });

  protected dreamTitle(id: string | null): string | null {
    if (!id || this.dreamId()) return null;
    return this.data().dreams.find((d) => d.id === id)?.title ?? null;
  }

  protected isTicked(habit: HabitDto, day: string): boolean {
    return this.pending()[`${habit.id}:${day}`] ?? habit.checked.includes(day);
  }

  protected thisWeek(habit: HabitDto): number {
    const week = this.data().weekStart;
    let n = habit.thisWeek;
    for (const [key, done] of Object.entries(this.pending())) {
      const [id, day] = key.split(':');
      if (id !== habit.id || day! < week) continue;
      if (done !== habit.checked.includes(day!)) n += done ? 1 : -1;
    }
    return n;
  }

  protected add(): void {
    this.editor.add({ perWeek: 7, active: true, dreamId: this.dreamId() });
  }

  protected toggle(habit: HabitDto, day: string): void {
    const key = `${habit.id}:${day}`;
    const done = !this.isTicked(habit, day);
    this.pending.update((p) => ({ ...p, [key]: done }));
    const settle = () =>
      this.pending.update((p) => {
        const { [key]: _, ...rest } = p;
        return rest;
      });
    // The tick stays shown as you set it: once reloaded, the habit agrees.
    this.api.checkHabit(habit.id, day, done).subscribe({
      next: () => this.changed.emit(),
      error: (error: unknown) => {
        settle();
        this.failed.emit(errorText(error, 'Could not save it.', SERVICE));
      },
    });
  }
}
