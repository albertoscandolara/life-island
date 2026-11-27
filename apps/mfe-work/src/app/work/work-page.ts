import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import {
  entityParam,
  CAREER_EVENT_LABELS,
  CONTRACT_KINDS,
  CONTRACT_KIND_LABELS,
  HIRING_PLATFORM_PRESETS,
  identifiesWorkplace,
  latestPayslips,
  payslipYears,
  MANUAL_CAREER_EVENT_KINDS,
  PLATFORM_STALE_DAYS,
  PLATFORM_STATUS_LABELS,
  PLATFORM_STATUSES,
  WORKPLACE_FIELD_DEFINITIONS,
  WORKPLACE_STATUS_LABELS,
  WORKPLACE_STATUSES,
  type CareerEventDto,
  type CareerFeedbackDto,
  type HiringPlatformDto,
  type HiringPlatformRequest,
  type PendingWorkReviewDto,
  type PlatformStatus,
  type WorkOverviewDto,
  type WorkplaceChangeSuggestion,
  type WorkplaceDto,
  type WorkplaceField,
  type WorkplaceFieldGroup,
  type WorkplaceStatus,
} from '@life-island/contracts';
import {
  UiAiPanel,
  UiAiStatus,
  UiAlert,
  UiBadge,
  UiButton,
  UiCard,
  UiEmptyState,
  UiIcon,
  UiDialog,
  UiInfoGuide,
  UiInfoTopic,
  UiPageHeader,
  type UiTone,
} from '@life-island/design-system';
import { AiTool } from '@life-island/settings-ui';
import type { Observable } from 'rxjs';
import { WorkApi } from '../api/work-api';
import { AuditTab } from './audit-tab';
import { EvaluationsTab } from './evaluations-tab';
import { JobsTab } from './jobs-tab';
import { PayAnalysisTab } from './pay-analysis-tab';
import { PayslipsTab } from './payslips-tab';
import { PayslipArchive } from './payslip-archive';
import { WORK_STEP_BADGES, workSteps, type WorkStep } from './next-steps';
import { PensionGuideTopic } from './pension-guide-topic';
import {
  CU_GUIDE,
  PAYSLIP_GUIDE,
  REVIEWS_GUIDE,
  TFR_GUIDE,
} from './work-guide';
import { WorkGuideSections } from './work-guide-sections';
import { PensionTab } from './pension-tab';
import { TfrTab } from './tfr-tab';
import { ToolsTab, type OfferDraft } from './tools-tab';
import {
  duration,
  euro,
  eventEmblem,
  eventLabel,
  eventTone,
  fieldLabel,
  parseNumber,
  pct,
  dateText,
  periodText,
  safeUrl,
  signed,
  typeLabel,
  valueText,
  workplaceName,
} from './labels';
import {
  LiDelta,
  LiNeedsYou,
  LiReviewItem,
  LiTabs,
  LiToReview,
  urlTab,
  type LiTab,
} from '@life-island/records-ui';

/**
 * The tabs Work once had: a link to `?tab=analysis` (from the Agenda, the 730
 * or a bookmark) opens the block it now lives in.
 */
export type WorkTab =
  | 'work'
  | 'review'
  | 'career'
  | 'payslips'
  | 'analysis'
  | 'evaluations'
  | 'workplaces'
  | 'feedback'
  | 'audit'
  | 'tfr'
  | 'pension'
  | 'tools'
  | 'jobs'
  | 'platforms';

export const SECTION_OF: Record<Exclude<WorkTab, 'work' | 'review'>, string> = {
  career: 'work-career',
  payslips: 'work-payslips',
  analysis: 'work-analysis',
  evaluations: 'work-evaluations',
  workplaces: 'work-workplaces',
  feedback: 'work-feedback',
  audit: 'work-audit',
  tfr: 'work-tfr',
  pension: 'work-pension',
  tools: 'work-tools',
  jobs: 'work-jobs',
  platforms: 'work-platforms',
};

/** True when `?tab=` names one of today's tabs, which `urlTab` opens. */
function isView(value: string): value is WorkView {
  return (WORK_VIEWS as readonly string[]).includes(value);
}

/** The views of the page, each a tab. */
export const WORK_VIEWS = [
  'overview',
  'payslips',
  'pay',
  'career',
  'pension',
  'jobs',
  'review',
] as const;
export type WorkView = (typeof WORK_VIEWS)[number];

/** The tab each block of the page lives in, for a link or a step to open it. */
export const VIEW_OF: Record<string, WorkView> = {
  'work-payslips': 'payslips',
  'work-audit': 'payslips',
  'work-pay': 'pay',
  'work-analysis': 'pay',
  'work-career': 'career',
  'work-evaluations': 'career',
  'work-workplaces': 'career',
  'work-later': 'pension',
  'work-tfr': 'pension',
  'work-pension': 'pension',
  'work-next': 'jobs',
  'work-tools': 'jobs',
  'work-jobs': 'jobs',
  'work-feedback': 'jobs',
  'work-platforms': 'jobs',
};

/** The choices you make on one document waiting for review. */
interface Draft {
  /** The workplace it is about; 'new' adds one from it. */
  workplaceId: string;
  accept: Set<WorkplaceField>;
  /** The name of a new workplace. */
  label: string;
}

interface EventDraft {
  date: string;
  kind: (typeof MANUAL_CAREER_EVENT_KINDS)[number];
  title: string;
  detail: string;
  workplaceId: string;
  amount: string;
}

interface PlatformDraft {
  /** The platform being edited; null adds one. */
  id: string | null;
  name: string;
  url: string;
  account: string;
  status: PlatformStatus;
  profileUpdatedAt: string;
  notes: string;
}

const SUGGESTION_LABELS: Record<WorkplaceChangeSuggestion, string> = {
  accept: 'Take it',
  keep_current: 'Keep yours',
  check: 'Check it',
};

const SUGGESTION_TONES: Record<WorkplaceChangeSuggestion, UiTone> = {
  accept: 'success',
  keep_current: 'neutral',
  check: 'warning',
};

const GROUP_LABELS: Record<WorkplaceFieldGroup, string> = {
  employer: 'Employer and site',
  employment: 'Your employment',
  pay: 'Pay',
};

export { parseNumber } from './labels';

const today = () => new Date().toISOString().slice(0, 10);

/**
 * Work: your career at a glance (statistics, pay month by month and a
 * timeline of notable events), the review of the work documents that come in
 * (each suggests the values it prints for its workplace), your workplaces as
 * entities, an AI feedback on your career and the hiring platforms you
 * signed up to.
 */
@Component({
  selector: 'work-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    LiDelta,
    LiNeedsYou,
    LiTabs,
    PayslipArchive,
    LiReviewItem,
    LiToReview,
    AiTool,
    AuditTab,
    EvaluationsTab,
    JobsTab,
    PayAnalysisTab,
    PayslipsTab,
    PensionGuideTopic,
    WorkGuideSections,
    PensionTab,
    TfrTab,
    ToolsTab,
    UiAiPanel,
    UiAiStatus,
    UiAlert,
    UiBadge,
    UiButton,
    UiCard,
    UiEmptyState,
    UiIcon,
    UiDialog,
    UiInfoGuide,
    UiInfoTopic,
    UiPageHeader,
  ],
  host: { 'data-character': 'pachy', class: 'work' },
  templateUrl: './work-page.html',
  styleUrls: ['./blocks.css', './work-page.css'],
})
export class WorkPage {
  private readonly api = inject(WorkApi);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  protected readonly overview = signal<WorkOverviewDto | null>(null);
  protected readonly error = signal<string | null>(null);
  protected readonly busy = signal<string | null>(null);
  protected readonly tab = urlTab(WORK_VIEWS, 'overview');
  /** The year the payslip grid shows; null: the latest. */
  protected readonly archiveYear = signal<number | null>(null);
  /** A section to open once the page is drawn (from a link or a step). */
  private pendingJump: string | null = null;
  /** The Work guide: reading matter kept out of the tabs, opened on demand. */
  protected readonly guideOpen = signal(false);
  protected readonly guideTopic = signal('payslip');
  protected readonly guides = {
    payslip: PAYSLIP_GUIDE,
    cu: CU_GUIDE,
    tfr: TFR_GUIDE,
    reviews: REVIEWS_GUIDE,
  };
  protected readonly selectedId = signal<string | null>(null);
  /** The selected workplace's details are open, in a dialog. */
  protected readonly workplaceOpen = signal(false);
  private readonly drafts = signal<Record<string, Draft>>({});
  /** The values being edited on the selected workplace, or null when not editing. */
  protected readonly editing = signal<{
    label: string;
    status: WorkplaceStatus;
    notes: string;
    values: Record<string, string>;
  } | null>(null);
  protected readonly removing = signal(false);
  protected readonly adding = signal<{
    employer: string;
    label: string;
  } | null>(null);
  protected readonly notableOnly = signal(false);
  protected readonly eventDraft = signal<EventDraft | null>(null);
  protected readonly platformDraft = signal<PlatformDraft | null>(null);
  protected readonly question = signal('');
  protected readonly asking = signal(false);
  protected readonly shownFeedbackId = signal<string | null>(null);
  /** An offer from the job search, for the comparison in Tools. */
  protected readonly offerPrefill = signal<OfferDraft | null>(null);

  protected readonly stepBadges = WORK_STEP_BADGES;
  protected readonly tabs = computed<LiTab[]>(() => [
    { id: 'overview', label: 'Overview', icon: 'home' },
    { id: 'payslips', label: 'Payslips', icon: 'file' },
    { id: 'pay', label: 'Pay and taxes', icon: 'chart' },
    { id: 'career', label: 'Career', icon: 'layers' },
    { id: 'pension', label: 'TFR and pension', icon: 'shield' },
    { id: 'jobs', label: 'Job search', icon: 'search' },
    {
      id: 'review',
      label: 'To review',
      icon: 'inbox',
      count: this.reviews().length || undefined,
    },
  ]);
  protected readonly contractKinds = CONTRACT_KINDS;
  protected readonly contractKindLabels = CONTRACT_KIND_LABELS;
  protected readonly manualKinds = MANUAL_CAREER_EVENT_KINDS;
  protected readonly eventKindLabels = CAREER_EVENT_LABELS;
  protected readonly presets = HIRING_PLATFORM_PRESETS;
  protected readonly platformStatuses = PLATFORM_STATUSES;
  protected readonly platformStatusLabels = PLATFORM_STATUS_LABELS;
  protected readonly staleDays = PLATFORM_STALE_DAYS;
  protected readonly workplaceStatuses = WORKPLACE_STATUSES;
  protected readonly workplaceStatusLabels = WORKPLACE_STATUS_LABELS;
  protected readonly suggestionLabels = SUGGESTION_LABELS;
  protected readonly suggestionTones = SUGGESTION_TONES;
  protected readonly groups = (['employer', 'employment', 'pay'] as const).map(
    (group) => ({
      group,
      label: GROUP_LABELS[group],
      fields: WORKPLACE_FIELD_DEFINITIONS.filter((d) => d.group === group),
    }),
  );

  protected readonly euro = euro;
  protected readonly duration = duration;
  protected readonly periodText = periodText;
  protected readonly dateText = dateText;
  protected readonly signed = signed;
  protected readonly fieldLabel = fieldLabel;
  protected readonly typeLabel = typeLabel;
  protected readonly valueText = valueText;
  protected readonly workplaceName = workplaceName;
  protected readonly eventLabel = eventLabel;
  protected readonly eventTone = eventTone;
  protected readonly eventEmblem = eventEmblem;
  protected readonly safeUrl = safeUrl;
  protected readonly pct = pct;

  protected readonly workplaces = computed(
    () => this.overview()?.workplaces ?? [],
  );
  protected readonly reviews = computed(() => this.overview()?.reviews ?? []);
  protected readonly rejected = computed(() => this.overview()?.rejected ?? []);
  protected readonly stats = computed(() => this.overview()?.stats ?? null);
  protected readonly platforms = computed(
    () => this.overview()?.platforms ?? [],
  );
  protected readonly feedback = computed(() => this.overview()?.feedback ?? []);
  protected readonly shownFeedback = computed<CareerFeedbackDto | null>(
    () =>
      this.feedback().find((f) => f.id === this.shownFeedbackId()) ??
      this.feedback()[0] ??
      null,
  );
  protected readonly timeline = computed(() => {
    const all = this.overview()?.timeline ?? [];
    return this.notableOnly() ? all.filter((e) => e.notable) : all;
  });
  /** The timeline grouped by year, newest first. */
  protected readonly timelineYears = computed(() => {
    const years = new Map<string, CareerEventDto[]>();
    for (const event of this.timeline()) {
      const year = event.date.slice(0, 4);
      years.set(year, [...(years.get(year) ?? []), event]);
    }
    return [...years.entries()].map(([year, events]) => ({ year, events }));
  });
  protected readonly selected = computed<WorkplaceDto | null>(
    () =>
      this.workplaces().find((w) => w.id === this.selectedId()) ??
      this.workplaces().at(0) ??
      null,
  );
  protected readonly stalePlatforms = computed(() =>
    this.platforms().filter((p) => p.stale),
  );

  /** Your payslips year by year, month by month, for the grid and the steps. */
  protected readonly payslipYears = computed(() => {
    const data = this.overview();
    if (!data) return [];
    return payslipYears({
      workplaces: data.workplaces,
      certificates: data.certificates,
      checks: data.stats.checks,
      findings: data.audit.findings,
      today: today(),
    });
  });

  protected readonly latest = computed(() =>
    latestPayslips(this.payslipYears()),
  );

  /** The job the page is about: the current one, else the latest. */
  protected readonly job = computed<WorkplaceDto | null>(
    () =>
      this.workplaces().find((w) => w.status === 'current') ??
      this.workplaces()[0] ??
      null,
  );

  protected readonly steps = computed<WorkStep[]>(() => {
    const data = this.overview();
    return data ? workSteps(data, this.payslipYears(), today()) : [];
  });

  /** Steps that are late, due or to check: the ideas do not count. */
  protected readonly urgentSteps = computed(
    () => this.steps().filter((s) => s.level !== 'idea').length,
  );

  /** Gross of the latest year with payslips, against the same months of the year before. */
  protected readonly yearToDate = computed(() => {
    const monthly = this.stats()?.monthly ?? [];
    const year = Number(
      monthly.at(-1)?.period.slice(0, 4) ?? today().slice(0, 4),
    );
    const own = monthly.filter((m) => m.period.startsWith(`${year}-`));
    // The same months of the year before, so a month missing either side does not count.
    const months = new Set(own.map((m) => m.period.slice(5)));
    const before = monthly.filter(
      (m) =>
        m.period.startsWith(`${year - 1}-`) && months.has(m.period.slice(5)),
    );
    const sum = (list: typeof monthly) =>
      list.reduce((total, m) => total + (m.gross ?? 0), 0);
    return {
      year,
      gross: sum(own),
      months: own.length,
      before: before.length === own.length ? sum(before) : null,
    };
  });

  constructor() {
    // A link from anywhere on the island opens one workplace: /work?workplace=<id>.
    // Only a new id opens the tab, so a click on another tab is not undone.
    let opened: string | null = null;
    this.route.queryParamMap.pipe(takeUntilDestroyed()).subscribe((query) => {
      const id = query.get(entityParam('workplace'));
      if (!id || id === opened) return;
      opened = id;
      this.openWorkplace(id);
    });
    // `?tab=analysis` (an old tab) and `#work-pension` open their block.
    this.route.queryParamMap.pipe(takeUntilDestroyed()).subscribe((query) => {
      const old = query.get('tab');
      if (old && old in SECTION_OF && !isView(old))
        this.jump(SECTION_OF[old as keyof typeof SECTION_OF]);
    });
    this.route.fragment.pipe(takeUntilDestroyed()).subscribe((fragment) => {
      if (fragment?.startsWith('work-')) this.jump(fragment);
    });
    // `?guide=pension` opens the guide, from a link anywhere on the island.
    this.route.queryParamMap.pipe(takeUntilDestroyed()).subscribe((query) => {
      const topic = query.get('guide');
      if (topic) this.showGuide(topic);
    });
    this.load();
  }

  protected showGuide(topic: string): void {
    this.guideTopic.set(topic);
    this.guideOpen.set(true);
  }

  /** A closed guide leaves the URL, so a reload does not open it again. */
  protected onGuideClosed(): void {
    if (!this.route.snapshot.queryParamMap.get('guide')) return;
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { guide: null },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }

  /** Opens the tab a block lives in and scrolls to it, once it is drawn. */
  protected jump(id: string): void {
    const view = VIEW_OF[id] ?? 'overview';
    if (this.tab() !== view) this.tab.set(view);
    this.pendingJump = id;
    if (this.overview()) this.scrollToPending();
  }

  private scrollToPending(): void {
    const id = this.pendingJump;
    if (!id) return;
    setTimeout(() => {
      const target = document.getElementById(id);
      if (!target) return;
      this.pendingJump = null;
      target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }

  /** Does what a step of What's next asks: the review, or its section. */
  protected follow(step: WorkStep): void {
    if (step.target.kind === 'review') {
      this.tab.set('review');
      return;
    }
    if (step.target.year) this.archiveYear.set(step.target.year);
    this.jump(step.target.id);
  }

  /** Opens one workplace with its details and documents. */
  /** Opens a workplace's details, in a dialog over the page. */
  protected openWorkplace(id: string): void {
    this.select(id);
    this.workplaceOpen.set(true);
  }

  /** A workplace's documents but its payslips, which have their own grid. */
  protected otherDocuments(workplace: WorkplaceDto) {
    return workplace.documents.filter((d) => d.type !== 'PAYSLIP');
  }

  protected payslipCount(workplace: WorkplaceDto): number {
    return workplace.documents.filter((d) => d.type === 'PAYSLIP').length;
  }

  protected downloadUrl(uploadId: string): string {
    return this.api.downloadUrl(uploadId);
  }

  protected load(): void {
    this.api.overview().subscribe({
      next: (overview) => {
        this.overview.set(overview);
        this.error.set(null);
        this.scrollToPending();
      },
      error: () =>
        this.error.set(
          'Work could not be loaded. Is svc-work running? Try again in a moment.',
        ),
    });
  }

  private run(
    key: string,
    call: () => Observable<unknown>,
    after?: () => void,
  ): void {
    this.busy.set(key);
    call().subscribe({
      next: () => {
        this.busy.set(null);
        after?.();
        this.load();
      },
      error: (error: { error?: { message?: string | string[] } }) => {
        this.busy.set(null);
        const message = error.error?.message;
        this.error.set(
          (Array.isArray(message) ? message.join(', ') : message) ??
            'That did not work. Try again in a moment.',
        );
      },
    });
  }

  protected value(workplace: WorkplaceDto, field: string) {
    return workplace.values[field as WorkplaceField] ?? null;
  }

  protected nameOf(workplaceId: string | null): string {
    const workplace = this.workplaces().find((w) => w.id === workplaceId);
    return workplace ? workplaceName(workplace) : '';
  }

  /** Open an offer of the job search in the comparison of Tools. */
  protected compareOffer(draft: OfferDraft): void {
    this.offerPrefill.set({ ...draft });
    this.jump('work-tools');
  }

  // ---- review -------------------------------------------------------------

  protected draft(review: PendingWorkReviewDto): Draft {
    return (
      this.drafts()[review.uploadId] ?? {
        workplaceId:
          review.workplaceId ??
          (identifiesWorkplace(review)
            ? 'new'
            : (this.workplaces()[0]?.id ?? 'new')),
        accept: new Set(
          review.changes
            .filter((c) => c.suggestion === 'accept')
            .map((c) => c.field),
        ),
        label: '',
      }
    );
  }

  private updateDraft(review: PendingWorkReviewDto, change: Partial<Draft>) {
    this.drafts.update((all) => ({
      ...all,
      [review.uploadId]: { ...this.draft(review), ...change },
    }));
  }

  protected chooseWorkplace(review: PendingWorkReviewDto, id: string): void {
    this.updateDraft(review, { workplaceId: id });
  }

  protected setDraftLabel(review: PendingWorkReviewDto, label: string): void {
    this.updateDraft(review, { label });
  }

  protected toggle(review: PendingWorkReviewDto, field: WorkplaceField): void {
    const accept = new Set(this.draft(review).accept);
    if (accept.has(field)) accept.delete(field);
    else accept.add(field);
    this.updateDraft(review, { accept });
  }

  /** The changes against the workplace you picked (the server compared with its match). */
  protected changesFor(review: PendingWorkReviewDto) {
    return this.draft(review).workplaceId === review.workplaceId
      ? review.changes
      : [];
  }

  protected readable(review: PendingWorkReviewDto): boolean {
    return identifiesWorkplace(review);
  }

  protected isNew(review: PendingWorkReviewDto): boolean {
    return this.draft(review).workplaceId === 'new';
  }

  protected approve(review: PendingWorkReviewDto): void {
    const draft = this.draft(review);
    const isNew = draft.workplaceId === 'new';
    this.run(review.uploadId, () =>
      this.api.approve(review.uploadId, {
        workplaceId: isNew ? null : draft.workplaceId,
        accept: this.changesFor(review)
          .map((c) => c.field)
          .filter((f) => draft.accept.has(f)),
        label: isNew ? draft.label.trim() || null : undefined,
      }),
    );
  }

  protected reject(review: PendingWorkReviewDto): void {
    this.run(review.uploadId, () => this.api.reject(review.uploadId));
  }

  protected reopen(uploadId: string): void {
    this.run(uploadId, () => this.api.reopen(uploadId));
  }

  protected previewUrl(uploadId: string): string {
    return this.api.previewUrl(uploadId);
  }

  // ---- workplaces ---------------------------------------------------------

  protected select(id: string): void {
    this.selectedId.set(id);
    this.editing.set(null);
    this.removing.set(false);
  }

  protected startEdit(workplace: WorkplaceDto): void {
    this.editing.set({
      label: workplace.label ?? '',
      status: workplace.status,
      notes: workplace.notes ?? '',
      values: Object.fromEntries(
        Object.entries(workplace.values).map(([k, v]) => [
          k,
          v === null ? '' : String(v),
        ]),
      ),
    });
  }

  protected editValue(field: string, value: string): void {
    this.editing.update((e) =>
      e ? { ...e, values: { ...e.values, [field]: value } } : e,
    );
  }

  protected editMeta(
    change: Partial<{ label: string; status: WorkplaceStatus; notes: string }>,
  ): void {
    this.editing.update((e) => (e ? { ...e, ...change } : e));
  }

  protected saveEdit(workplace: WorkplaceDto): void {
    const edit = this.editing();
    if (!edit) return;
    const values: Partial<Record<WorkplaceField, string | number | null>> = {};
    for (const d of WORKPLACE_FIELD_DEFINITIONS) {
      const raw = (edit.values[d.field] ?? '').trim();
      const before = workplace.values[d.field as WorkplaceField];
      const now =
        raw === ''
          ? null
          : ['amount', 'number', 'integer'].includes(d.type)
            ? parseNumber(raw)
            : raw;
      if (typeof now === 'number' && !Number.isFinite(now)) continue;
      if (String(before ?? '') !== String(now ?? ''))
        values[d.field as WorkplaceField] = now;
    }
    this.run(
      workplace.id,
      () =>
        this.api.updateWorkplace(workplace.id, {
          label: edit.label.trim() || null,
          status: edit.status,
          notes: edit.notes.trim() || null,
          values,
        }),
      () => this.editing.set(null),
    );
  }

  protected remove(workplace: WorkplaceDto): void {
    this.run(
      workplace.id,
      () => this.api.removeWorkplace(workplace.id),
      () => {
        this.removing.set(false);
        this.workplaceOpen.set(false);
        this.selectedId.set(null);
      },
    );
  }

  protected addWorkplace(): void {
    const adding = this.adding();
    if (!adding?.employer.trim()) return;
    this.run(
      'add-workplace',
      () =>
        this.api.createWorkplace({
          employerName: adding.employer.trim(),
          label: adding.label.trim() || null,
        }),
      () => this.adding.set(null),
    );
  }

  protected setAdding(change: Partial<{ employer: string; label: string }>) {
    this.adding.update((a) => ({ employer: '', label: '', ...a, ...change }));
  }

  // ---- events -------------------------------------------------------------

  protected startEvent(): void {
    this.eventDraft.set({
      date: today(),
      kind: 'course',
      title: '',
      detail: '',
      workplaceId:
        this.workplaces().find((w) => w.status === 'current')?.id ?? '',
      amount: '',
    });
  }

  protected setEvent(change: Partial<EventDraft>): void {
    this.eventDraft.update((e) => (e ? { ...e, ...change } : e));
  }

  protected saveEvent(): void {
    const draft = this.eventDraft();
    if (!draft?.title.trim() || !draft.date) return;
    const amount = draft.amount.trim() ? parseNumber(draft.amount) : null;
    this.run(
      'event',
      () =>
        this.api.addEvent({
          date: draft.date,
          kind: draft.kind,
          title: draft.title.trim(),
          detail: draft.detail.trim() || null,
          workplaceId: draft.workplaceId || null,
          amount: amount !== null && Number.isFinite(amount) ? amount : null,
        }),
      () => this.eventDraft.set(null),
    );
  }

  protected removeEvent(event: CareerEventDto): void {
    this.run(event.id, () => this.api.removeEvent(event.id));
  }

  // ---- feedback -----------------------------------------------------------

  protected ask(): void {
    this.asking.set(true);
    this.error.set(null);
    this.api.askFeedback(this.question().trim() || null).subscribe({
      next: (feedback) => {
        this.asking.set(false);
        this.question.set('');
        this.shownFeedbackId.set(feedback.id);
        this.load();
      },
      error: (error: { error?: { message?: string } }) => {
        this.asking.set(false);
        this.error.set(
          error.error?.message ??
            'The feedback could not be written. Try again in a moment.',
        );
      },
    });
  }

  protected removeFeedback(feedback: CareerFeedbackDto): void {
    this.run(
      feedback.id,
      () => this.api.removeFeedback(feedback.id),
      () => this.shownFeedbackId.set(null),
    );
  }

  // ---- platforms ----------------------------------------------------------

  protected startPlatform(
    preset?: { name: string; url: string },
    platform?: HiringPlatformDto,
  ): void {
    this.platformDraft.set(
      platform
        ? {
            id: platform.id,
            name: platform.name,
            url: platform.url,
            account: platform.account ?? '',
            status: platform.status,
            profileUpdatedAt: platform.profileUpdatedAt ?? '',
            notes: platform.notes ?? '',
          }
        : {
            id: null,
            name: preset?.name ?? '',
            url: preset?.url ?? 'https://',
            account: '',
            status: 'active',
            profileUpdatedAt: '',
            notes: '',
          },
    );
  }

  protected setPlatform(change: Partial<PlatformDraft>): void {
    this.platformDraft.update((p) => (p ? { ...p, ...change } : p));
  }

  protected hasPlatform(name: string): boolean {
    return this.platforms().some(
      (p) => p.name.toLowerCase() === name.toLowerCase(),
    );
  }

  protected savePlatform(): void {
    const draft = this.platformDraft();
    if (!draft?.name.trim() || !draft.url.trim()) return;
    const request: HiringPlatformRequest = {
      name: draft.name.trim(),
      url: draft.url.trim(),
      account: draft.account.trim() || null,
      status: draft.status,
      profileUpdatedAt: draft.profileUpdatedAt || null,
      notes: draft.notes.trim() || null,
    };
    this.run(
      draft.id ?? 'platform',
      () =>
        draft.id
          ? this.api.updatePlatform(draft.id, request)
          : this.api.addPlatform(request),
      () => this.platformDraft.set(null),
    );
  }

  /** "I updated it today": the quickest way to clear a stale profile. */
  protected touchPlatform(platform: HiringPlatformDto): void {
    this.run(platform.id, () =>
      this.api.updatePlatform(platform.id, {
        name: platform.name,
        url: platform.url,
        account: platform.account,
        status: platform.status,
        profileUpdatedAt: today(),
        notes: platform.notes,
      }),
    );
  }

  protected removePlatform(platform: HiringPlatformDto): void {
    this.run(platform.id, () => this.api.removePlatform(platform.id));
  }

  protected hostOf(url: string): string {
    try {
      return new URL(url).host.replace(/^www\./, '');
    } catch {
      return url;
    }
  }
}
