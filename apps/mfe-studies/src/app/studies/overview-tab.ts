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
  STUDY_TOPIC_LABELS,
  STUDY_TOPICS,
  type StudiesOverviewDto,
  type StudyReminderDto,
  type StudyTopic,
} from '@life-island/contracts';
import {
  UiBadge,
  UiButton,
  UiCard,
  UiEmptyState,
  UiIcon,
  UiProgressBar,
  type UiTone,
} from '@life-island/design-system';
import { StudiesApi } from '../api/studies-api';
import type { StudiesTab } from './studies-page';
import {
  dateText,
  daysText,
  duration,
  errorText,
  euro,
  hours,
  textOrNull,
  today,
  TOPIC_COLORS,
} from './labels';

interface SessionDraft {
  date: string;
  minutes: number;
  /** `step:<id>`, `course:<id>`, `topic:<topic>`. */
  what: string;
  note: string;
}

const REMINDER_TONES: Record<StudyReminderDto['severity'], UiTone> = {
  danger: 'danger',
  warning: 'warning',
  info: 'info',
};

const REMINDER_TABS: Record<StudyReminderDto['kind'], StudiesTab> = {
  subscription: 'platforms',
  exam: 'courses',
  certification: 'courses',
  idle: 'overview',
  target: 'paths',
};

/** This week: your time against the goal, what needs you, a session to log, the paths you follow. */
@Component({
  selector: 'studies-overview',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [UiBadge, UiButton, UiCard, UiEmptyState, UiIcon, UiProgressBar],
  templateUrl: './overview-tab.html',
  styleUrls: ['./blocks.css', './overview-tab.css'],
})
export class OverviewTab {
  private readonly api = inject(StudiesApi);

  readonly data = input.required<StudiesOverviewDto>();
  readonly changed = output<void>();
  readonly failed = output<string>();
  readonly openPath = output<string>();
  readonly openTab = output<StudiesTab>();

  protected readonly topics = STUDY_TOPICS;
  protected readonly topicLabels = STUDY_TOPIC_LABELS;
  protected readonly topicColors = TOPIC_COLORS;
  protected readonly reminderTones = REMINDER_TONES;
  protected readonly quick = [25, 50, 90];
  protected readonly duration = duration;
  protected readonly hours = hours;
  protected readonly euro = euro;
  protected readonly dateText = dateText;
  protected readonly daysText = daysText;
  protected readonly busy = signal(false);
  protected readonly draft = signal<SessionDraft>(this.emptyDraft());

  protected readonly stats = computed(() => this.data().stats);
  protected readonly goalMinutes = computed(
    () => this.stats().weeklyGoalHours * 60,
  );
  protected readonly weekShare = computed(() =>
    this.goalMinutes()
      ? Math.min(
          100,
          Math.round((this.stats().weekMinutes / this.goalMinutes()) * 100),
        )
      : 0,
  );
  protected readonly followed = computed(() =>
    this.data()
      .paths.filter((p) => p.status === 'following')
      .map((p) => ({
        progress: p,
        path: learningPath(p.pathId)!,
        next: p.nextStepId ? pathStep(p.nextStepId) : undefined,
      }))
      .filter((p) => !!p.path),
  );
  /** What a session can be about: the open steps of the paths you follow, your courses, a topic. */
  protected readonly options = computed(() => {
    const steps = this.followed().map(({ path, progress }) => ({
      label: path.name,
      items: progress.steps
        .filter((s) => s.status !== 'done')
        .slice(0, 6)
        .map((s) => ({
          value: `step:${s.stepId}`,
          label: pathStep(s.stepId)?.title ?? s.stepId,
        })),
    }));
    const courses = this.data()
      .courses.filter(
        (c) => c.status === 'in_progress' || c.status === 'planned',
      )
      .map((c) => ({ value: `course:${c.id}`, label: c.title }));
    return { steps: steps.filter((g) => g.items.length), courses };
  });
  /** The 12 weeks, with the height of each topic's part (percent of the tallest week or the goal). */
  protected readonly weeks = computed(() => {
    const weeks = this.stats().weeks;
    const top = Math.max(
      this.goalMinutes(),
      ...weeks.map((w) => w.minutes),
      60,
    );
    return {
      goal: Math.round((this.goalMinutes() / top) * 100),
      bars: weeks.map((w) => ({
        week: w,
        label: dateText(w.weekStart).replace(/ \d{4}$/, ''),
        parts: STUDY_TOPICS.filter((t) => w.byTopic[t]).map((t) => ({
          topic: t,
          height: ((w.byTopic[t] ?? 0) / top) * 100,
        })),
      })),
    };
  });
  protected readonly recent = computed(() => this.data().sessions.slice(0, 8));
  protected readonly topicsUsed = computed(() =>
    STUDY_TOPICS.filter((t) =>
      this.stats().weeks.some((w) => (w.byTopic[t] ?? 0) > 0),
    ),
  );

  private emptyDraft(): SessionDraft {
    return { date: today(), minutes: 50, what: '', note: '' };
  }

  protected set(patch: Partial<SessionDraft>): void {
    this.draft.update((d) => ({ ...d, ...patch }));
  }

  protected sessionLabel(s: StudiesOverviewDto['sessions'][number]): string {
    if (s.stepId) return pathStep(s.stepId)?.title ?? s.stepId;
    if (s.courseId)
      return (
        this.data().courses.find((c) => c.id === s.courseId)?.title ??
        'A course'
      );
    if (s.pathId) return learningPath(s.pathId)?.name ?? s.pathId;
    return STUDY_TOPIC_LABELS[s.topic];
  }

  protected log(): void {
    const d = this.draft();
    const [kind, value] = d.what.split(':') as [string, string];
    this.busy.set(true);
    this.api
      .addSession({
        date: d.date,
        minutes: d.minutes,
        stepId: kind === 'step' ? value : null,
        courseId: kind === 'course' ? value : null,
        topic: kind === 'topic' ? (value as StudyTopic) : undefined,
        note: textOrNull(d.note),
      })
      .subscribe({
        next: () => {
          this.busy.set(false);
          this.draft.set({ ...this.emptyDraft(), what: d.what });
          this.changed.emit();
        },
        error: (error: unknown) => {
          this.busy.set(false);
          this.failed.emit(errorText(error, 'Could not log the session.'));
        },
      });
  }

  protected remove(id: string): void {
    this.api.removeSession(id).subscribe({
      next: () => this.changed.emit(),
      error: (error: unknown) =>
        this.failed.emit(errorText(error, 'Could not remove the session.')),
    });
  }

  protected act(reminder: StudyReminderDto): void {
    if (reminder.kind === 'target' && reminder.refId)
      this.openPath.emit(reminder.refId);
    else this.openTab.emit(REMINDER_TABS[reminder.kind]);
  }
}
