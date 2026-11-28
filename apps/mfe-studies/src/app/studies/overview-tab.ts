import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
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
  type StudyTopic,
} from '@life-island/contracts';
import {
  UiBadge,
  UiButton,
  UiCard,
  UiColumnChart,
  UiDialog,
  UiEmptyState,
  UiIcon,
  type UiChartSeries,
} from '@life-island/design-system';
import { StudiesApi } from '../api/studies-api';
import { CoachTab } from './coach-tab';
import { RecallBlock } from './recall-block';
import type { StudiesTab } from './studies-page';
import {
  dateText,
  duration,
  errorText,
  hours,
  safeUrl,
  textOrNull,
  today,
  TOPIC_COLORS,
} from './labels';
import { sessionMinutes, STUDY_TIMER_KEY, type RunningSession } from './timer';
import { upNext, type UpNextItem } from './up-next';

interface SessionDraft {
  date: string;
  minutes: number;
  /** `step:<id>`, `course:<id>`, `topic:<topic>`. */
  what: string;
  note: string;
}

/**
 * Overview: what to study now (Up next, with Study now), your week planned
 * by the coach, your weeks against the goal and the latest sessions.
 */
@Component({
  selector: 'studies-overview',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CoachTab,
    RecallBlock,
    UiBadge,
    UiButton,
    UiCard,
    UiColumnChart,
    UiDialog,
    UiEmptyState,
    UiIcon,
  ],
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
  protected readonly quick = [25, 50, 90];
  protected readonly duration = duration;
  protected readonly hours = hours;
  protected readonly dateText = dateText;
  protected readonly safeUrl = safeUrl;
  protected readonly busy = signal(false);
  protected readonly logOpen = signal(false);
  protected readonly draft = signal<SessionDraft>(this.emptyDraft());

  /** The session being timed, kept in the browser so a reload keeps it. */
  protected readonly running = signal<RunningSession | null>(readTimer());
  /** Set after a timed session on a step: "done with this step?". */
  protected readonly askDone = signal<{ stepId: string; title: string } | null>(
    null,
  );
  private readonly now = signal(Date.now());

  protected readonly items = computed(() => upNext(this.data()));
  protected readonly elapsed = computed(() => {
    const r = this.running();
    return r ? Math.max(0, this.now() - r.startedAt) : 0;
  });

  constructor() {
    const tick = setInterval(() => {
      if (this.running()) this.now.set(Date.now());
    }, 1000);
    inject(DestroyRef).onDestroy(() => clearInterval(tick));
  }

  protected clock(ms: number): string {
    const total = Math.floor(ms / 1000);
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    const two = (n: number) => String(n).padStart(2, '0');
    return h ? `${h}:${two(m)}:${two(s)}` : `${two(m)}:${two(s)}`;
  }

  // ---- the chart --------------------------------------------------------

  protected readonly chart = computed(() => {
    const weeks = this.data().stats.weeks;
    const used = STUDY_TOPICS.filter((t) =>
      weeks.some((w) => (w.byTopic[t] ?? 0) > 0),
    );
    const series: UiChartSeries[] = used.map((t) => ({
      id: t,
      label: STUDY_TOPIC_LABELS[t],
      color: TOPIC_COLORS[t],
      values: weeks.map((w) => {
        const minutes = w.byTopic[t] ?? 0;
        return minutes ? Math.round((minutes / 60) * 10) / 10 : null;
      }),
    }));
    const goal = this.data().stats.weeklyGoalHours;
    return {
      buckets: weeks.map((w) => w.weekStart),
      series,
      goal: goal
        ? {
            id: 'goal',
            label: `Goal, ${goal} h`,
            color: 'var(--text-secondary)',
            values: weeks.map(() => goal),
          }
        : null,
    };
  });
  protected readonly hoursAxis = (v: number) =>
    `${v.toLocaleString('it-IT')} h`;
  protected readonly weekLabel = (key: string) => `Week of ${dateText(key)}`;
  protected readonly weekShort = (key: string) =>
    dateText(key).replace(/ \d{4}$/, '');

  protected readonly recent = computed(() => this.data().sessions.slice(0, 6));

  // ---- Study now ----------------------------------------------------------

  protected start(item: UpNextItem): void {
    const session: RunningSession = {
      key: item.key,
      title: item.title,
      stepId: item.courseId ? null : item.stepId,
      courseId: item.courseId,
      startedAt: Date.now(),
    };
    this.askDone.set(null);
    this.now.set(Date.now());
    this.running.set(session);
    writeTimer(session);
  }

  protected cancel(): void {
    this.running.set(null);
    writeTimer(null);
  }

  /** Stops the timer and logs the session on its step or course. */
  protected stop(): void {
    const r = this.running();
    if (!r) return;
    const minutes = sessionMinutes(Date.now() - r.startedAt);
    this.save(
      {
        date: today(),
        minutes,
        stepId: r.stepId,
        courseId: r.courseId,
        note: null,
      },
      () => {
        this.cancel();
        if (r.stepId) this.askDone.set({ stepId: r.stepId, title: r.title });
      },
    );
  }

  /** Logs a session you did not time, on the step or course of a card. */
  protected logQuick(item: UpNextItem, minutes: number): void {
    this.save({
      date: today(),
      minutes,
      stepId: item.courseId ? null : item.stepId,
      courseId: item.courseId,
      note: null,
    });
  }

  protected markDone(stepId: string): void {
    this.askDone.set(null);
    this.api.setStep(stepId, { status: 'done' }).subscribe({
      next: () => this.changed.emit(),
      error: (error: unknown) =>
        this.failed.emit(errorText(error, 'Could not mark the step done.')),
    });
  }

  // ---- logging by hand ----------------------------------------------------

  /** What a session can be about: the open steps of the paths you follow, your courses, a topic. */
  protected readonly options = computed(() => {
    const data = this.data();
    const steps = data.paths
      .filter((p) => p.status === 'following')
      .map((p) => ({
        label: learningPath(p.pathId, data.catalogue)?.name ?? p.pathId,
        items: p.steps
          .filter((s) => s.status !== 'done')
          .slice(0, 6)
          .map((s) => ({
            value: `step:${s.stepId}`,
            label: pathStep(s.stepId, data.catalogue)?.title ?? s.stepId,
          })),
      }))
      .filter((g) => g.items.length);
    const courses = data.courses
      .filter((c) => c.status === 'in_progress' || c.status === 'planned')
      .map((c) => ({ value: `course:${c.id}`, label: c.title }));
    return { steps, courses };
  });

  private emptyDraft(): SessionDraft {
    return { date: today(), minutes: 50, what: '', note: '' };
  }

  protected set(patch: Partial<SessionDraft>): void {
    this.draft.update((d) => ({ ...d, ...patch }));
  }

  protected log(): void {
    const d = this.draft();
    const [kind, value] = d.what.split(':') as [string, string];
    this.save(
      {
        date: d.date,
        minutes: d.minutes,
        stepId: kind === 'step' ? value : null,
        courseId: kind === 'course' ? value : null,
        topic: kind === 'topic' ? (value as StudyTopic) : undefined,
        note: textOrNull(d.note),
      },
      () => {
        this.draft.set({ ...this.emptyDraft(), what: d.what });
        this.logOpen.set(false);
      },
    );
  }

  private save(
    request: Parameters<StudiesApi['addSession']>[0],
    after?: () => void,
  ): void {
    this.busy.set(true);
    this.api.addSession(request).subscribe({
      next: () => {
        this.busy.set(false);
        after?.();
        this.changed.emit();
      },
      error: (error: unknown) => {
        this.busy.set(false);
        this.failed.emit(errorText(error, 'Could not log the session.'));
      },
    });
  }

  protected sessionLabel(s: StudiesOverviewDto['sessions'][number]): string {
    const data = this.data();
    if (s.stepId) return pathStep(s.stepId, data.catalogue)?.title ?? s.stepId;
    if (s.courseId)
      return data.courses.find((c) => c.id === s.courseId)?.title ?? 'A course';
    if (s.pathId)
      return learningPath(s.pathId, data.catalogue)?.name ?? s.pathId;
    return STUDY_TOPIC_LABELS[s.topic];
  }

  protected remove(id: string): void {
    this.api.removeSession(id).subscribe({
      next: () => this.changed.emit(),
      error: (error: unknown) =>
        this.failed.emit(errorText(error, 'Could not remove the session.')),
    });
  }
}

function readTimer(): RunningSession | null {
  try {
    const raw = localStorage.getItem(STUDY_TIMER_KEY);
    return raw ? (JSON.parse(raw) as RunningSession) : null;
  } catch {
    return null;
  }
}

function writeTimer(session: RunningSession | null): void {
  try {
    if (session) localStorage.setItem(STUDY_TIMER_KEY, JSON.stringify(session));
    else localStorage.removeItem(STUDY_TIMER_KEY);
  } catch {
    // The timer still runs, it is only not kept across a reload.
  }
}
