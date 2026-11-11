import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
} from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import {
  GOAL_AREA_LABELS,
  isoAddDays,
  LIFE_GOAL_STATUS_LABELS,
  type GoalsCoachDto,
  type GoalsOverviewDto,
  type GoalStepDto,
  type HabitDto,
  type LifeGoalDto,
} from '@life-island/contracts';
import {
  UiAiPanel,
  UiAiStatus,
  UiAlert,
  UiButton,
  UiCard,
  UiEmptyState,
  UiIcon,
  UiPageHeader,
} from '@life-island/design-system';
import {
  LiDue,
  LiRecordDialog,
  LiTabs,
  RecordEditor,
  dateText,
  dayText,
  errorText,
  liOptions,
  type LiField,
  type LiTab,
} from '@life-island/records-ui';
import { AiTool } from '@life-island/settings-ui';
import { GoalsApi } from '../api/goals-api';

type GoalsTab = 'goals' | 'habits' | 'week' | 'coach';
const TABS: readonly GoalsTab[] = ['goals', 'habits', 'week', 'coach'];
const SERVICE = 'svc-goals';

const GOAL_FIELDS: readonly LiField[] = [
  { key: 'title', label: 'Goal', type: 'text', required: true, wide: true, placeholder: 'Run a 10 km race, change job, save €5,000…' },
  { key: 'area', label: 'Area of life', type: 'select', required: true, options: liOptions(GOAL_AREA_LABELS) },
  { key: 'targetDate', label: 'By', type: 'date', hint: 'Optional' },
  { key: 'why', label: 'Why it matters to you', type: 'textarea', wide: true, hint: 'Read it again when motivation dips' },
  { key: 'measure', label: 'Reached when', type: 'text', wide: true, placeholder: 'I finish a 10 km race in under an hour' },
  { key: 'status', label: 'Status', type: 'select', required: true, options: liOptions(LIFE_GOAL_STATUS_LABELS) },
];

const STEP_FIELDS: readonly LiField[] = [
  { key: 'title', label: 'Step', type: 'text', required: true, wide: true, hint: 'Small enough to do in one sitting' },
  { key: 'dueDate', label: 'By', type: 'date', hint: 'Optional; it shows in the Agenda' },
  { key: 'done', label: 'Done', type: 'checkbox' },
];

const MOODS = [
  { value: 1, label: '😣', name: 'Rough' },
  { value: 2, label: '😕', name: 'Meh' },
  { value: 3, label: '😐', name: 'OK' },
  { value: 4, label: '🙂', name: 'Good' },
  { value: 5, label: '😄', name: 'Great' },
];

/**
 * Goals & habits (Rex): what you want to reach and why, the steps towards
 * it, the habits that get you there, a weekly look back, and a coach that
 * spots what is stuck.
 */
@Component({
  selector: 'goals-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    AiTool,
    LiDue,
    LiRecordDialog,
    LiTabs,
    UiAiPanel,
    UiAiStatus,
    UiAlert,
    UiButton,
    UiCard,
    UiEmptyState,
    UiIcon,
    UiPageHeader,
  ],
  host: { 'data-character': 'rex', class: 'goals' },
  templateUrl: './goals-page.html',
  styleUrl: './goals-page.css',
})
export class GoalsPage {
  private readonly api = inject(GoalsApi);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  protected readonly data = signal<GoalsOverviewDto | null>(null);
  protected readonly error = signal<string | null>(null);
  protected readonly tab = signal<string>(this.initialTab());
  protected readonly showClosed = signal(false);
  protected readonly dateText = dateText;
  protected readonly dayText = dayText;
  protected readonly goalFields = GOAL_FIELDS;
  protected readonly stepFields = STEP_FIELDS;
  protected readonly moods = MOODS;

  protected readonly goals = new RecordEditor(this.api, 'goals', () => this.load(), SERVICE);
  protected readonly steps = new RecordEditor(this.api, 'steps', () => this.load(), SERVICE, ['goalId']);
  protected readonly habits = new RecordEditor(this.api, 'habits', () => this.load(), SERVICE);

  // The weekly review form
  protected readonly mood = signal<number | null>(null);
  protected readonly wins = signal('');
  protected readonly stuck = signal('');
  protected readonly next = signal('');
  protected readonly savingReview = signal(false);
  protected readonly reviewSaved = signal(false);

  // The coach
  protected readonly question = signal('');
  protected readonly asking = signal(false);
  protected readonly coachStatus = signal<'idle' | 'done' | 'error'>('idle');
  protected readonly shownAdvice = signal<string | null>(null);

  protected readonly habitFields = computed<LiField[]>(() => [
    { key: 'title', label: 'Habit', type: 'text', required: true, wide: true, placeholder: 'Walk 30 minutes, read 10 pages…' },
    { key: 'perWeek', label: 'Days a week', type: 'number', required: true, min: 1, max: 7 },
    {
      key: 'goalId',
      label: 'For the goal',
      type: 'select',
      emptyLabel: 'None',
      options: (this.data()?.goals ?? []).filter((g) => g.status === 'active').map((g) => ({ value: g.id, label: g.title })),
    },
    { key: 'active', label: 'Active', type: 'checkbox' },
  ]);

  protected readonly openGoals = computed(() =>
    (this.data()?.goals ?? []).filter((g) => g.status === 'active' || g.status === 'paused'),
  );
  protected readonly closedGoals = computed(() =>
    (this.data()?.goals ?? []).filter((g) => g.status === 'done' || g.status === 'dropped'),
  );
  protected readonly stuckCount = computed(() => this.openGoals().filter((g) => g.stuck).length);

  /** The last seven days, oldest first, for the habit grid. */
  protected readonly days = computed(() => {
    const today = this.data()?.today;
    if (!today) return [];
    return Array.from({ length: 7 }, (_, i) => isoAddDays(today, i - 6));
  });

  protected readonly tabs = computed<LiTab[]>(() => {
    const d = this.data();
    const habitsLeft = (d?.habits ?? []).filter((h) => h.active && !h.checked.includes(d!.today)).length;
    return [
      { id: 'goals', label: 'Goals', icon: 'flame', count: this.stuckCount() },
      { id: 'habits', label: 'Habits', icon: 'check', count: habitsLeft },
      { id: 'week', label: 'Weekly review', icon: 'calendar', count: d && !d.reviewedThisWeek ? 1 : 0 },
      { id: 'coach', label: 'Coach', icon: 'sparkles' },
    ];
  });

  protected readonly advice = computed<GoalsCoachDto | null>(() => {
    const all = this.data()?.advice ?? [];
    return all.find((a) => a.id === this.shownAdvice()) ?? all[0] ?? null;
  });

  constructor() {
    this.load();
  }

  private initialTab(): GoalsTab {
    const tab = this.route.snapshot.queryParamMap.get('tab') as GoalsTab | null;
    return tab && TABS.includes(tab) ? tab : 'goals';
  }

  protected setTab(tab: string): void {
    this.tab.set(tab);
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { tab: tab === 'goals' ? null : tab },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }

  protected load(): void {
    this.api.overview().subscribe({
      next: (data) => {
        const first = !this.data();
        this.data.set(data);
        this.error.set(null);
        if (first) this.fillReview(data);
      },
      error: (error: unknown) =>
        this.error.set(errorText(error, 'Could not load your goals.', SERVICE)),
    });
  }

  private fillReview(data: GoalsOverviewDto): void {
    const current = data.reviews.find((r) => r.weekStart === data.weekStart);
    this.mood.set(current?.mood ?? null);
    this.wins.set(current?.wins ?? '');
    this.stuck.set(current?.stuck ?? '');
    this.next.set(current?.next ?? '');
  }

  protected area(goal: LifeGoalDto): string {
    return GOAL_AREA_LABELS[goal.area];
  }

  protected status(goal: LifeGoalDto): string {
    return LIFE_GOAL_STATUS_LABELS[goal.status];
  }

  protected addGoal(): void {
    this.goals.add({ area: 'health', status: 'active' });
  }

  protected addStep(goal: LifeGoalDto): void {
    this.steps.add({ goalId: goal.id, done: false });
  }

  protected toggleStep(step: GoalStepDto): void {
    this.api.update('steps', step.id, { done: !step.done }).subscribe({
      next: () => this.load(),
      error: (error: unknown) => this.error.set(errorText(error, 'Could not save it.', SERVICE)),
    });
  }

  protected addHabit(): void {
    this.habits.add({ perWeek: 7, active: true, goalId: null });
  }

  protected toggleDay(habit: HabitDto, day: string): void {
    const done = !habit.checked.includes(day);
    // Show it at once, then confirm with the service.
    this.data.update((d) =>
      d
        ? {
            ...d,
            habits: d.habits.map((h) =>
              h.id === habit.id
                ? {
                    ...h,
                    checked: done ? [...h.checked, day] : h.checked.filter((c) => c !== day),
                    thisWeek: h.thisWeek + (day >= d.weekStart ? (done ? 1 : -1) : 0),
                  }
                : h,
            ),
          }
        : d,
    );
    this.api.checkHabit(habit.id, day, done).subscribe({
      next: () => this.load(),
      error: (error: unknown) => {
        this.error.set(errorText(error, 'Could not save it.', SERVICE));
        this.load();
      },
    });
  }

  protected goalTitle(id: string | null): string | null {
    return this.data()?.goals.find((g) => g.id === id)?.title ?? null;
  }

  protected saveReview(): void {
    const d = this.data();
    if (!d) return;
    this.savingReview.set(true);
    this.reviewSaved.set(false);
    this.api
      .saveWeeklyReview({
        weekStart: d.weekStart,
        mood: this.mood(),
        wins: this.wins(),
        stuck: this.stuck(),
        next: this.next(),
      })
      .subscribe({
        next: () => {
          this.savingReview.set(false);
          this.reviewSaved.set(true);
          this.load();
        },
        error: (error: unknown) => {
          this.savingReview.set(false);
          this.error.set(errorText(error, 'Could not save the review.', SERVICE));
        },
      });
  }

  protected moodLabel(mood: number | null): string {
    return MOODS.find((m) => m.value === mood)?.label ?? '';
  }

  protected ask(): void {
    this.asking.set(true);
    this.coachStatus.set('idle');
    this.api.coach({ question: this.question().trim() || null }).subscribe({
      next: (advice) => {
        this.asking.set(false);
        this.coachStatus.set('done');
        this.shownAdvice.set(advice.id);
        this.question.set('');
        this.load();
      },
      error: (error: unknown) => {
        this.asking.set(false);
        this.coachStatus.set('error');
        this.error.set(errorText(error, 'The coach could not answer.', SERVICE));
      },
    });
  }

  protected removeAdvice(id: string): void {
    this.api.removeAdvice(id).subscribe({
      next: () => {
        this.shownAdvice.set(null);
        this.load();
      },
      error: (error: unknown) => this.error.set(errorText(error, 'Could not remove it.', SERVICE)),
    });
  }
}
