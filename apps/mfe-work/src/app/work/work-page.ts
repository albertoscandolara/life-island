import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
} from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import {
  CAREER_EVENT_LABELS,
  CONTRACT_KINDS,
  CONTRACT_KIND_LABELS,
  HIRING_PLATFORM_PRESETS,
  identifiesWorkplace,
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
  UiAlert,
  UiBadge,
  UiButton,
  UiCard,
  UiEmptyState,
  UiIcon,
  UiPageHeader,
  type UiIconName,
  type UiTone,
} from '@life-island/design-system';
import type { Observable } from 'rxjs';
import { WorkApi } from '../api/work-api';
import { EvaluationsTab } from './evaluations-tab';
import { PayAnalysisTab } from './pay-analysis-tab';
import { PayslipsTab } from './payslips-tab';
import { ToolsTab } from './tools-tab';
import {
  duration,
  euro,
  eventEmblem,
  eventLabel,
  eventTone,
  fieldLabel,
  parseNumber,
  pct,
  periodText,
  safeUrl,
  scoreText,
  signed,
  typeLabel,
  valueText,
  workplaceName,
} from './labels';

export type WorkTab =
  | 'career'
  | 'payslips'
  | 'analysis'
  | 'evaluations'
  | 'review'
  | 'workplaces'
  | 'feedback'
  | 'tools'
  | 'platforms';

const TABS: {
  id: WorkTab;
  label: string;
  icon: UiIconName;
}[] = [
  { id: 'career', label: 'Overview', icon: 'chart' },
  { id: 'payslips', label: 'Payslips', icon: 'file' },
  { id: 'analysis', label: 'Pay analysis', icon: 'layers' },
  { id: 'evaluations', label: 'Performance reviews', icon: 'check' },
  { id: 'review', label: 'To review', icon: 'inbox' },
  { id: 'workplaces', label: 'Workplaces', icon: 'home' },
  { id: 'feedback', label: 'Career feedback', icon: 'info' },
  { id: 'tools', label: 'Tools', icon: 'wrench' },
  { id: 'platforms', label: 'Hiring platforms', icon: 'external' },
];

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
    EvaluationsTab,
    PayAnalysisTab,
    PayslipsTab,
    ToolsTab,
    UiAlert,
    UiBadge,
    UiButton,
    UiCard,
    UiEmptyState,
    UiIcon,
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
  protected readonly tab = signal<WorkTab>(this.initialTab());
  protected readonly selectedId = signal<string | null>(null);
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

  protected readonly tabs = TABS;
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
  protected readonly scoreText = scoreText;
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

  protected readonly evaluations = computed(
    () => this.overview()?.evaluations ?? null,
  );

  /**
   * Pay and evaluations side by side, year by year: what the payslips say
   * you earned and what the evaluations say about the same year.
   */
  protected readonly years = computed(() => {
    const pay = this.stats()?.years ?? [];
    const reviews = this.evaluations()?.years ?? [];
    const all = [
      ...new Set([...pay.map((y) => y.year), ...reviews.map((y) => y.year)]),
    ].sort((a, b) => b - a);
    return all.map((year) => {
      const p = pay.find((y) => y.year === year) ?? null;
      const r = reviews.find((y) => y.year === year) ?? null;
      return {
        year,
        payslips: p?.payslips ?? 0,
        gross: p?.gross ?? null,
        net: p?.net ?? null,
        evaluations: r?.evaluations ?? 0,
        averageScore: r?.averageScore ?? null,
        bonus: r?.bonus || null,
        bonusShareOfGrossPct: r?.bonusShareOfGrossPct ?? null,
        role: r?.role ?? null,
      };
    });
  });

  /** The latest year with both a bonus and payslips: how much of your pay the evaluations moved. */
  protected readonly bonusShare = computed(
    () =>
      this.years().find((y) => y.bonus && y.bonusShareOfGrossPct !== null) ??
      null,
  );

  constructor() {
    this.load();
  }

  private initialTab(): WorkTab {
    const tab = this.route.snapshot.queryParamMap.get('tab');
    return TABS.some((t) => t.id === tab) ? (tab as WorkTab) : 'career';
  }

  protected setTab(tab: WorkTab): void {
    this.tab.set(tab);
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { tab: tab === 'career' ? null : tab },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }

  protected load(): void {
    this.api.overview().subscribe({
      next: (overview) => {
        this.overview.set(overview);
        this.error.set(null);
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

  protected tabCount(tab: WorkTab): number | null {
    if (tab === 'review') return this.reviews().length || null;
    if (tab === 'platforms') return this.stalePlatforms().length || null;
    return null;
  }

  protected value(workplace: WorkplaceDto, field: string) {
    return workplace.values[field as WorkplaceField] ?? null;
  }

  protected nameOf(workplaceId: string | null): string {
    const workplace = this.workplaces().find((w) => w.id === workplaceId);
    return workplace ? workplaceName(workplace) : '';
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
