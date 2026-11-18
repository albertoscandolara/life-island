import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
} from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import {
  INTENSITY_LABELS,
  WORKOUT_KIND_LABELS,
  type FitnessOverviewDto,
  type TrainingPlanDto,
  type WorkoutDto,
  type WorkoutKind,
} from '@life-island/contracts';
import {
  UiAiPanel,
  UiAiStatus,
  UiAlert,
  UiButton,
  UiCard,
  UiEmptyState,
  UiIcon,
  UiLineChart,
  UiPageHeader,
  UiProgressBar,
  type UiChartSeries,
} from '@life-island/design-system';
import {
  LiBars,
  LiDue,
  LiRecordDialog,
  LiTabs,
  RecordEditor,
  dateText,
  dayText,
  duration,
  errorText,
  localToday,
  monthText,
  type LiBar,
  MEASUREMENT_FIELDS,
  WORKOUT_FIELDS,
  type LiField,
  type LiTab,
  LiNeedsYou,
} from '@life-island/records-ui';
import { AiTool } from '@life-island/settings-ui';
import { FitnessApi } from '../api/fitness-api';

type FitnessTab = 'week' | 'body' | 'events' | 'plan';
const TABS: readonly FitnessTab[] = ['week', 'body', 'events', 'plan'];
const SERVICE = 'svc-fitness';

const EVENT_FIELDS: readonly LiField[] = [
  {
    key: 'name',
    label: 'Event',
    type: 'text',
    required: true,
    placeholder: 'Milano 10 km, a hike, a padel tournament',
  },
  { key: 'date', label: 'Date', type: 'date', required: true },
  {
    key: 'target',
    label: 'Target',
    type: 'text',
    placeholder: 'Finish, under 55 minutes…',
  },
  { key: 'done', label: 'Done', type: 'checkbox' },
  { key: 'result', label: 'Result', type: 'text' },
  { key: 'notes', label: 'Notes', type: 'textarea' },
];

const EMOJI: Record<WorkoutKind, string> = {
  walk: '🚶',
  run: '🏃',
  cycle: '🚴',
  swim: '🏊',
  gym: '🏋️',
  yoga: '🧘',
  hike: '🥾',
  sport: '🎾',
  other: '✨',
};

/**
 * Fitness (Galli): your workouts as active minutes against a weekly goal,
 * weight, sleep and steps over time, the events you train for, and a coach
 * that plans your week.
 */
@Component({
  selector: 'fitness-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    LiNeedsYou,
    UiProgressBar,
    AiTool,
    LiBars,
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
    UiLineChart,
    UiPageHeader,
  ],
  host: { 'data-character': 'galli', class: 'fitness' },
  templateUrl: './fitness-page.html',
  styleUrl: './fitness-page.css',
})
export class FitnessPage {
  private readonly api = inject(FitnessApi);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  protected readonly data = signal<FitnessOverviewDto | null>(null);
  protected readonly error = signal<string | null>(null);
  protected readonly tab = signal<string>(this.initialTab());
  protected readonly dateText = dateText;
  protected readonly dayText = dayText;
  protected readonly duration = duration;
  protected readonly emoji = EMOJI;
  protected readonly workoutFields = WORKOUT_FIELDS;
  protected readonly measurementFields = MEASUREMENT_FIELDS;
  protected readonly eventFields = EVENT_FIELDS;

  protected readonly workouts = new RecordEditor(
    this.api,
    'workouts',
    () => this.load(),
    SERVICE,
  );
  protected readonly measurements = new RecordEditor(
    this.api,
    'measurements',
    () => this.load(),
    SERVICE,
  );
  protected readonly events = new RecordEditor(
    this.api,
    'events',
    () => this.load(),
    SERVICE,
  );

  protected readonly question = signal('');
  protected readonly asking = signal(false);
  protected readonly planStatus = signal<'idle' | 'done' | 'error'>('idle');
  protected readonly shownPlan = signal<string | null>(null);

  protected readonly tabs = computed<LiTab[]>(() => [
    { id: 'week', label: 'This week', icon: 'flame' },
    { id: 'body', label: 'Body and sleep', icon: 'chart' },
    { id: 'events', label: 'Events', icon: 'calendar' },
    { id: 'plan', label: 'Plan', icon: 'sparkles' },
  ]);

  protected readonly weekBars = computed<LiBar[]>(() =>
    (this.data()?.weeks ?? []).map((w) => ({
      label: w.weekStart.slice(8) + '/' + w.weekStart.slice(5, 7),
      value: w.activeMinutes,
      tone:
        w.activeMinutes >= (this.data()?.goalMinutes ?? 150)
          ? 'accent'
          : 'muted',
      title: `Week of ${dateText(w.weekStart)}: ${w.activeMinutes} active minutes in ${w.workouts} workouts`,
    })),
  );

  protected readonly thisWeek = computed<WorkoutDto[]>(() => {
    const d = this.data();
    return d ? d.workouts.filter((w) => w.date >= d.weekStart) : [];
  });

  protected readonly progress = computed(() => {
    const d = this.data();
    return d
      ? Math.min(100, Math.round((d.stats.thisWeek / d.goalMinutes) * 100))
      : 0;
  });

  /** Every weight written, oldest first, with the goal from Settings. */
  protected readonly weight = computed(() => {
    const d = this.data();
    const points = [...(d?.measurements ?? [])]
      .filter((m): m is typeof m & { weightKg: number } => m.weightKg !== null)
      .reverse();
    if (points.length < 2) return null;
    const goal = d?.goalWeightKg ?? null;
    const last = points[points.length - 1].weightKg;
    const series: UiChartSeries[] = [
      {
        id: 'weight',
        label: 'Weight',
        color: 'var(--viz-1)',
        values: points.map((p) => p.weightKg),
      },
    ];
    return {
      series,
      categories: points.map((p) => monthText(p.date, true)),
      title: (i: number) => dateText(points[i]?.date),
      goal: goal ? { value: goal, label: `Goal ${goal} kg` } : null,
      toGo: goal ? Math.round((last - goal) * 10) / 10 : null,
      points,
    };
  });
  protected readonly kg = (v: number) => `${Math.round(v * 10) / 10} kg`;

  protected readonly plan = computed<TrainingPlanDto | null>(() => {
    const all = this.data()?.plans ?? [];
    return all.find((p) => p.id === this.shownPlan()) ?? all[0] ?? null;
  });

  constructor() {
    this.load();
  }

  private initialTab(): FitnessTab {
    const tab = this.route.snapshot.queryParamMap.get(
      'tab',
    ) as FitnessTab | null;
    return tab && TABS.includes(tab) ? tab : 'week';
  }

  protected setTab(tab: string): void {
    this.tab.set(tab);
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { tab: tab === 'week' ? null : tab },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }

  protected load(): void {
    this.api.overview().subscribe({
      next: (data) => {
        this.data.set(data);
        this.error.set(null);
      },
      error: (error: unknown) =>
        this.error.set(
          errorText(error, 'Could not load your fitness.', SERVICE),
        ),
    });
  }

  protected kind(k: WorkoutKind): string {
    return WORKOUT_KIND_LABELS[k];
  }

  protected intensity(w: WorkoutDto): string {
    return INTENSITY_LABELS[w.intensity];
  }

  protected addWorkout(kind: WorkoutKind = 'walk'): void {
    this.workouts.add({
      date: localToday(),
      kind,
      intensity: 'moderate',
      minutes: 30,
    });
  }

  protected ask(): void {
    this.asking.set(true);
    this.planStatus.set('idle');
    this.api.plan({ question: this.question().trim() || null }).subscribe({
      next: (p) => {
        this.asking.set(false);
        this.planStatus.set('done');
        this.shownPlan.set(p.id);
        this.question.set('');
        this.load();
      },
      error: (error: unknown) => {
        this.asking.set(false);
        this.planStatus.set('error');
        this.error.set(errorText(error, 'Could not plan the week.', SERVICE));
      },
    });
  }

  protected removePlan(id: string): void {
    this.api.removePlan(id).subscribe({
      next: () => {
        this.shownPlan.set(null);
        this.load();
      },
      error: (error: unknown) =>
        this.error.set(errorText(error, 'Could not remove it.', SERVICE)),
    });
  }

  protected readonly quickKinds: WorkoutKind[] = [
    'walk',
    'run',
    'cycle',
    'gym',
    'yoga',
    'swim',
  ];
}
