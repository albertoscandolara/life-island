import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
} from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import {
  DREAM_AREA_EMBLEMS,
  DREAM_AREA_LABELS,
  DREAM_CONTEXT_AREAS,
  DREAM_CONTEXT_SOURCES,
  DREAM_FEELINGS,
  DREAM_NEXT_PACE_LABELS,
  DREAM_NEXT_PACES,
  DREAM_PACE_LABELS,
  DREAM_STATUS_LABELS,
  DREAM_STEP_KIND_LABELS,
  DREAM_STRETCH_LABELS,
  DREAM_STRETCHES,
  type DreamContextArea,
  type DreamContextDto,
  type DreamDto,
  type DreamNextPace,
  type DreamsOverviewDto,
  type DreamStepDto,
  type DreamStepStatus,
  type DreamStretch,
} from '@life-island/contracts';
import {
  UiAiPanel,
  UiAiStatus,
  UiAlert,
  UiButton,
  UiCard,
  UiDialog,
  UiEmptyState,
  UiIcon,
  UiPageHeader,
} from '@life-island/design-system';
import {
  LiRecordDialog,
  LiTabs,
  RecordEditor,
  dateText,
  errorText,
  euro,
  liOptions,
  type LiField,
  type LiTab,
  LiNeedsYou,
  urlTab,
} from '@life-island/records-ui';
import { AiTool } from '@life-island/settings-ui';
import { DreamsApi } from '../api/dreams-api';
import { DreamSky } from './dream-sky';
import { DreamHabits } from '../habits/dream-habits';
import { WeeklyReview } from '../habits/weekly-review';

type DreamTab = 'dream' | 'questions' | 'steps' | 'check-ins' | 'safety';
const TABS: readonly DreamTab[] = [
  'dream',
  'questions',
  'steps',
  'check-ins',
  'safety',
];
/** The page's own views: your dreams, the habits you repeat, and your week. */
type PageView = 'dreams' | 'habits' | 'week';
const VIEWS: readonly PageView[] = ['dreams', 'habits', 'week'];
const SERVICE = 'svc-dreams';

const DREAM_FIELDS: readonly LiField[] = [
  {
    key: 'title',
    label: 'My dream',
    type: 'text',
    required: true,
    wide: true,
    placeholder: 'Work somewhere I feel valued',
  },
  {
    key: 'area',
    label: 'Area of life',
    type: 'select',
    required: true,
    options: liOptions(DREAM_AREA_LABELS),
  },
  {
    key: 'pace',
    label: 'Pace',
    type: 'select',
    required: true,
    options: liOptions(DREAM_PACE_LABELS),
  },
  {
    key: 'story',
    label: 'In my own words',
    type: 'textarea',
    wide: true,
    hint: 'As you would tell it to a friend',
  },
  {
    key: 'why',
    label: 'Why it matters to me',
    type: 'textarea',
    wide: true,
  },
  {
    key: 'today',
    label: 'Where I am today',
    type: 'textarea',
    wide: true,
    hint: 'What is not right now',
  },
  {
    key: 'fears',
    label: 'What scares me about it',
    type: 'textarea',
    wide: true,
  },
  {
    key: 'mustKeep',
    label: 'What I cannot put at risk',
    type: 'textarea',
    wide: true,
    placeholder: 'My salary every month, my evenings with the family…',
  },
  {
    key: 'measure',
    label: 'I will know it is reached when',
    type: 'text',
    wide: true,
    placeholder: 'I start a job where my ideas are heard',
  },
  {
    key: 'targetDate',
    label: 'Hoping for',
    type: 'date',
    hint: 'Optional; a wish, not a deadline. It shows in the Agenda',
  },
];

const STATUS_FIELD: LiField = {
  key: 'status',
  label: 'Status',
  type: 'select',
  required: true,
  options: liOptions(DREAM_STATUS_LABELS),
};

const STEP_FIELDS: readonly LiField[] = [
  {
    key: 'title',
    label: 'Step',
    type: 'text',
    required: true,
    wide: true,
    hint: 'Small enough for one sitting',
  },
  {
    key: 'kind',
    label: 'Kind',
    type: 'select',
    required: true,
    options: liOptions(DREAM_STEP_KIND_LABELS),
  },
  {
    key: 'stretch',
    label: 'How far out of the comfort zone',
    type: 'select',
    required: true,
    options: liOptions(DREAM_STRETCH_LABELS),
  },
  { key: 'minutes', label: 'About how long (minutes)', type: 'number', min: 0 },
  { key: 'costEuro', label: 'Money it costs', type: 'money' },
  {
    key: 'undo',
    label: 'How to undo it',
    type: 'text',
    wide: true,
    placeholder: 'It stays a private note',
  },
  {
    key: 'dueDate',
    label: 'By',
    type: 'date',
    hint: 'Optional; it shows in the Agenda',
  },
];

interface CheckInDraft {
  step: DreamStepDto | null;
  outcome: 'done' | 'skipped' | null;
}

/**
 * Dreams (Ovi): something you would love to reach, and a careful way
 * towards it. Write it, answer a few questions, take one small reversible
 * step at a time, and say how each felt so the next ones keep your pace.
 */
@Component({
  selector: 'dreams-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    LiNeedsYou,
    AiTool,
    DreamHabits,
    DreamSky,
    LiRecordDialog,
    LiTabs,
    NgTemplateOutlet,
    UiAiPanel,
    UiAiStatus,
    UiAlert,
    UiButton,
    UiCard,
    UiDialog,
    UiEmptyState,
    UiIcon,
    UiPageHeader,
    WeeklyReview,
  ],
  host: { 'data-character': 'ovi', class: 'dreams' },
  templateUrl: './dreams-page.html',
  styleUrl: './dreams-page.css',
})
export class DreamsPage {
  private readonly api = inject(DreamsApi);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  protected readonly data = signal<DreamsOverviewDto | null>(null);
  protected readonly error = signal<string | null>(null);
  protected readonly selectedId = signal<string | null>(
    this.route.snapshot.queryParamMap.get('dream'),
  );
  protected readonly tab = urlTab(TABS, 'dream');
  protected readonly view = urlTab(VIEWS, 'dreams', 'view');
  protected readonly showClosed = signal(false);
  protected readonly showHistory = signal(false);

  protected readonly dateText = dateText;
  protected readonly euro = euro;
  protected readonly areaLabels = DREAM_AREA_LABELS;
  protected readonly areaEmblems = DREAM_AREA_EMBLEMS;
  protected readonly statusLabels = DREAM_STATUS_LABELS;
  protected readonly kindLabels = DREAM_STEP_KIND_LABELS;
  protected readonly stretchLabels = DREAM_STRETCH_LABELS;
  protected readonly paceLabels = DREAM_PACE_LABELS;
  protected readonly nextPaceLabels = DREAM_NEXT_PACE_LABELS;
  protected readonly nextPaces = DREAM_NEXT_PACES;
  protected readonly feelings = DREAM_FEELINGS;
  protected readonly contextAreas = DREAM_CONTEXT_AREAS;
  protected readonly contextSources = DREAM_CONTEXT_SOURCES;
  protected readonly newDreamFields = DREAM_FIELDS;
  protected readonly editDreamFields = [...DREAM_FIELDS, STATUS_FIELD];
  protected readonly stepFields = STEP_FIELDS;

  protected readonly dreamEditor = new RecordEditor(
    this.api,
    'dreams',
    () => this.load(),
    SERVICE,
  );
  protected readonly stepEditor = new RecordEditor(
    this.api,
    'steps',
    () => this.load(),
    SERVICE,
    ['dreamId', 'status'],
  );

  // A new dream
  protected readonly adding = signal(false);
  protected readonly creating = signal(false);
  protected readonly createError = signal<string | null>(null);

  // Questions
  protected readonly asking = signal(false);
  protected readonly answers = signal<Record<string, string>>({});
  protected readonly savedAnswer = signal<string | null>(null);

  // Steps
  protected readonly note = signal('');
  protected readonly suggesting = signal(false);
  protected readonly suggestStatus = signal<'idle' | 'done' | 'error'>('idle');

  // Check-in
  protected readonly checkIn = signal<CheckInDraft | null>(null);
  protected readonly feeling = signal<number | null>(null);
  protected readonly checkInNote = signal('');
  protected readonly nextPace = signal<DreamNextPace>('same');
  protected readonly savingCheckIn = signal(false);
  protected readonly checkInOpen = signal(false);

  // Safety net
  protected readonly context = signal<DreamContextDto | null>(null);
  protected readonly contextFor = signal<string | null>(null);
  protected readonly loadingContext = signal(false);

  protected readonly openDreams = computed(() =>
    (this.data()?.dreams ?? []).filter(
      (d) => d.status !== 'reached' && d.status !== 'let-go',
    ),
  );
  protected readonly closedDreams = computed(() =>
    (this.data()?.dreams ?? []).filter(
      (d) => d.status === 'reached' || d.status === 'let-go',
    ),
  );

  protected readonly dream = computed<DreamDto | null>(() => {
    const all = this.data()?.dreams ?? [];
    return (
      all.find((d) => d.id === this.selectedId()) ??
      this.openDreams()[0] ??
      all[0] ??
      null
    );
  });

  protected readonly chosen = computed(() =>
    (this.dream()?.steps ?? []).filter((s) => s.status === 'chosen'),
  );
  protected readonly suggested = computed(() =>
    (this.dream()?.steps ?? []).filter((s) => s.status === 'suggested'),
  );
  protected readonly history = computed(() =>
    (this.dream()?.steps ?? []).filter(
      (s) => s.status === 'done' || s.status === 'skipped',
    ),
  );
  protected readonly awaiting = computed(() =>
    (this.dream()?.steps ?? []).filter((s) => s.awaitingCheckIn),
  );

  protected readonly tabs = computed<LiTab[]>(() => {
    const d = this.dream();
    return [
      { id: 'dream', label: 'The dream', icon: 'eye' },
      {
        id: 'questions',
        label: 'Questions',
        icon: 'info',
        count: d?.unansweredQuestions ?? 0,
      },
      {
        id: 'steps',
        label: 'Small steps',
        icon: 'layers',
        count: d ? (d.nextStep ? 0 : this.suggested().length) : 0,
      },
      {
        id: 'check-ins',
        label: 'Check-ins',
        icon: 'check',
        count: this.awaiting().length,
      },
      { id: 'safety', label: 'Safety net', icon: 'home' },
    ];
  });

  protected readonly views = computed<LiTab[]>(() => {
    const d = this.data();
    const habitsLeft = (d?.habits ?? []).filter(
      (h) => h.active && !h.checked.includes(d!.today),
    ).length;
    const waiting = (d?.dreams ?? []).reduce(
      (n, x) => n + x.steps.filter((s) => s.awaitingCheckIn).length,
      0,
    );
    return [
      { id: 'dreams', label: 'Dreams', icon: 'flame', count: waiting },
      { id: 'habits', label: 'Habits', icon: 'check', count: habitsLeft },
      {
        id: 'week',
        label: 'Your week',
        icon: 'calendar',
        count: d && !d.reviewedThisWeek ? 1 : 0,
      },
    ];
  });

  /** Where you are on the way: what to do now, in one line. */
  protected readonly nowHint = computed(() => {
    const d = this.dream();
    if (!d) return null;
    if (this.awaiting().length)
      return { tab: 'check-ins', text: 'Say how your last step felt' };
    if (!d.questions.length)
      return { tab: 'questions', text: 'Let Ovi ask a few questions first' };
    if (d.unansweredQuestions)
      return {
        tab: 'questions',
        text: `Answer ${d.unansweredQuestions} question${d.unansweredQuestions === 1 ? '' : 's'}, when you feel like it`,
      };
    if (d.stuck && d.nextStep)
      return {
        tab: 'steps',
        text: `${d.idleDays} days since the last step: try a smaller one, or rest`,
      };
    if (d.nextStep) return { tab: 'steps', text: `Next: ${d.nextStep.title}` };
    if (this.suggested().length)
      return { tab: 'steps', text: 'Pick one small step, or none for now' };
    return { tab: 'steps', text: 'Ask for the next small steps' };
  });

  constructor() {
    this.load();
  }

  private syncUrl(): void {
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { dream: this.selectedId() },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }

  protected setTab(tab: string): void {
    this.tab.set(tab);
    if (tab === 'safety') this.loadContext();
  }

  protected select(dream: DreamDto): void {
    this.selectedId.set(dream.id);
    this.suggestStatus.set('idle');
    this.syncUrl();
    if (this.tab() === 'safety') this.loadContext();
  }

  protected load(): void {
    this.api.overview().subscribe({
      next: (data) => {
        this.data.set(data);
        this.error.set(null);
        if (this.tab() === 'safety' && this.contextFor() !== this.dream()?.id)
          this.loadContext();
      },
      error: (error: unknown) =>
        this.error.set(
          errorText(error, 'Could not load your dreams.', SERVICE),
        ),
    });
  }

  private fail(message: string): (error: unknown) => void {
    return (error: unknown) =>
      this.error.set(errorText(error, message, SERVICE));
  }

  /** Replaces one dream in the page with what the service sent back. */
  private put(dream: DreamDto): void {
    this.data.update((d) =>
      d
        ? { ...d, dreams: d.dreams.map((x) => (x.id === dream.id ? dream : x)) }
        : d,
    );
  }

  // --- the dream ----------------------------------------------------------

  protected addDream(): void {
    this.createError.set(null);
    this.adding.set(true);
  }

  /** Saves a new dream, then lets Ovi ask its questions before anything else. */
  protected createDream(values: Record<string, unknown>): void {
    this.creating.set(true);
    this.createError.set(null);
    this.api.create('dreams', values).subscribe({
      next: ({ id }) => {
        this.creating.set(false);
        this.adding.set(false);
        this.selectedId.set(id);
        this.tab.set('questions', { dream: id });
        this.load();
        this.ask(id);
      },
      error: (error: unknown) => {
        this.creating.set(false);
        this.createError.set(errorText(error, 'Could not save it.', SERVICE));
      },
    });
  }

  protected toggleArea(dream: DreamDto, area: DreamContextArea): void {
    const contextAreas = dream.contextAreas.includes(area)
      ? dream.contextAreas.filter((a) => a !== area)
      : [...dream.contextAreas, area];
    this.put({ ...dream, contextAreas });
    this.api.update('dreams', dream.id, { contextAreas }).subscribe({
      next: () => {
        this.contextFor.set(null);
        if (this.tab() === 'safety') this.loadContext();
      },
      error: (error: unknown) => {
        this.fail('Could not save it.')(error);
        this.load();
      },
    });
  }

  protected setStatus(dream: DreamDto, status: DreamDto['status']): void {
    this.api.update('dreams', dream.id, { status }).subscribe({
      next: () => this.load(),
      error: this.fail('Could not save it.'),
    });
  }

  // --- questions ----------------------------------------------------------

  protected ask(id = this.dream()?.id): void {
    if (!id) return;
    this.asking.set(true);
    this.api.askQuestions(id).subscribe({
      next: (dream) => {
        this.asking.set(false);
        this.put(dream);
      },
      error: (error: unknown) => {
        this.asking.set(false);
        this.fail('Ovi could not ask its questions.')(error);
      },
    });
  }

  protected answerOf(q: { id: string; answer: string | null }): string {
    return this.answers()[q.id] ?? q.answer ?? '';
  }

  protected typeAnswer(id: string, value: string): void {
    this.answers.update((a) => ({ ...a, [id]: value }));
    if (this.savedAnswer() === id) this.savedAnswer.set(null);
  }

  protected saveAnswer(q: { id: string; answer: string | null }): void {
    const value = this.answerOf(q).trim();
    if (value === (q.answer ?? '')) return;
    this.api.answer(q.id, value || null).subscribe({
      next: () => {
        this.savedAnswer.set(q.id);
        this.load();
      },
      error: this.fail('Could not save your answer.'),
    });
  }

  // --- steps --------------------------------------------------------------

  protected suggest(): void {
    const d = this.dream();
    if (!d) return;
    this.suggesting.set(true);
    this.suggestStatus.set('idle');
    this.api.suggest(d.id, { note: this.note().trim() || null }).subscribe({
      next: (dream) => {
        this.suggesting.set(false);
        this.suggestStatus.set('done');
        this.note.set('');
        this.put(dream);
      },
      error: (error: unknown) => {
        this.suggesting.set(false);
        this.suggestStatus.set('error');
        this.fail('Ovi could not suggest steps.')(error);
      },
    });
  }

  protected setStep(step: DreamStepDto, status: DreamStepStatus): void {
    this.api.setStepStatus(step.id, status).subscribe({
      next: () => this.load(),
      error: this.fail('Could not save it.'),
    });
  }

  /** Takes the smaller version of a suggestion instead. */
  protected takeSmaller(step: DreamStepDto): void {
    if (!step.smaller) return;
    this.api
      .update('steps', step.id, {
        title: step.smaller,
        stretch: 'tiny',
        minutes: step.minutes
          ? Math.max(5, Math.round(step.minutes / 3))
          : null,
        smaller: null,
        status: 'chosen',
      })
      .subscribe({
        next: () => this.setStep(step, 'chosen'),
        error: this.fail('Could not save it.'),
      });
  }

  protected addStep(): void {
    const d = this.dream();
    if (d)
      this.stepEditor.add({
        dreamId: d.id,
        kind: 'reflect',
        stretch: 'tiny',
        status: 'chosen',
      });
  }

  /** The step a template slot receives, typed. */
  protected asStep(step: unknown): DreamStepDto {
    return step as DreamStepDto;
  }

  protected stretchDots(stretch: DreamStretch): boolean[] {
    const rank = DREAM_STRETCHES.indexOf(stretch);
    return DREAM_STRETCHES.map((_, i) => i <= rank);
  }

  protected costText(step: DreamStepDto): string {
    const parts: string[] = [];
    if (step.minutes) parts.push(minutesText(step.minutes));
    parts.push(step.costEuro ? euro(step.costEuro, false) : 'free');
    return parts.join(' · ');
  }

  // --- check-ins ----------------------------------------------------------

  protected openCheckIn(
    step: DreamStepDto | null,
    outcome: 'done' | 'skipped' | null,
  ): void {
    this.checkIn.set({ step, outcome });
    this.feeling.set(null);
    this.checkInNote.set('');
    this.nextPace.set(outcome === 'skipped' ? 'smaller' : 'same');
    this.checkInOpen.set(true);
  }

  protected saveCheckIn(): void {
    const d = this.dream();
    const draft = this.checkIn();
    const feeling = this.feeling();
    if (!d || !draft || feeling === null) return;
    this.savingCheckIn.set(true);
    this.api
      .checkIn({
        dreamId: d.id,
        stepId: draft.step?.id ?? null,
        outcome: draft.outcome,
        feeling,
        note: this.checkInNote(),
        nextPace: this.nextPace(),
      })
      .subscribe({
        next: () => {
          this.savingCheckIn.set(false);
          this.checkInOpen.set(false);
          this.load();
        },
        error: (error: unknown) => {
          this.savingCheckIn.set(false);
          this.fail('Could not save the check-in.')(error);
        },
      });
  }

  protected removeCheckIn(id: string): void {
    this.api.removeCheckIn(id).subscribe({
      next: () => this.load(),
      error: this.fail('Could not remove it.'),
    });
  }

  protected feelingOf(value: number) {
    return DREAM_FEELINGS.find((f) => f.value === value) ?? DREAM_FEELINGS[2];
  }

  // --- safety net ---------------------------------------------------------

  protected loadContext(): void {
    const d = this.dream();
    if (!d) return;
    this.loadingContext.set(true);
    this.contextFor.set(d.id);
    this.api.context(d.id).subscribe({
      next: (context) => {
        this.loadingContext.set(false);
        if (this.contextFor() === d.id) this.context.set(context);
      },
      error: (error: unknown) => {
        this.loadingContext.set(false);
        this.fail('Could not read the other areas.')(error);
      },
    });
  }

  protected runwayTone(months: number): 'good' | 'ok' | 'thin' {
    return months >= 6 ? 'good' : months >= 3 ? 'ok' : 'thin';
  }
}

function minutesText(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
}
