import { DatePipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  effect,
  inject,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { rxResource } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import type {
  CategoryCountsQuery,
  FileFormat,
  HistoricalStatus,
  ListRecordsQuery,
  RecordDto,
  RecordStatus,
  ReparseUploadsResponse,
} from '@life-island/contracts';
import {
  FILE_FORMATS,
  HISTORICAL_STATUSES,
  MODULE_LABELS,
  RECORD_STATUSES,
} from '@life-island/contracts/constants';
import {
  UiAlert,
  UiBadge,
  UiButton,
  UiCellDef,
  UiConfirmDialog,
  UiDropdown,
  UiFormField,
  UiIcon,
  UiInput,
  UiPageHeader,
  UiStatusDot,
  UiTable,
  type UiOption,
  type UiTableColumn,
  type UiTableSort,
} from '@life-island/design-system';
import { AiTool } from '@life-island/settings-ui';
import { IngestionApi } from '../api/ingestion-api';
import { ReviewApi } from '../api/review-api';
import { CategoryStore } from '../categories/category-store';
import { CategoryFilter } from './category-filter';
import { firstValueFrom } from 'rxjs';
import type { DocumentChanges } from './document-changes';
import { QueueBanner } from './queue-banner';
import {
  canReparse,
  HISTORICAL_STATUS_VIEW,
  RECORD_STATUS_VIEW,
} from './record-status';
import { ReclassificationState } from '../reclassification/reclassification-state';
import { reclassifyStartState } from '../reclassification/start-state';
import { LinkChecks } from './link-checks';
import { ReviewPanel, type ReviewOutcome } from './review-panel';

const PAGE_SIZE = 20;
/** How long after a parse run the inbox reloads again, for late events. */
const RUN_RELOAD_DELAY_MS = 2000;
type SortKey = NonNullable<ListRecordsQuery['sort']>;

/** What the inbox opens on: the records waiting for your review. */
export const DEFAULT_STATUS: RecordStatus = 'PARSED';
/** The `status` URL value for "any status" (no parameter means the default). */
const ANY_STATUS = 'all';

/** The status filter from the URL: none means the review queue, `all` means any. */
export function statusFromParam(param: string | null): RecordStatus | null {
  if (param === null) return DEFAULT_STATUS;
  if (param === ANY_STATUS) return null;
  return (RECORD_STATUSES as readonly string[]).includes(param)
    ? (param as RecordStatus)
    : DEFAULT_STATUS;
}

/** The status filter as a URL value: the inverse of `statusFromParam`. */
export function statusToParam(status: RecordStatus | null): string | undefined {
  if (status === DEFAULT_STATUS) return undefined;
  return status ?? ANY_STATUS;
}

/** Waits between checks that the inbox caught up with a change, in ms. */
export const CATCH_UP_DELAYS = [300, 600, 1200, 2400, 4800];

/** Whether a record in the inbox already shows the change you made. */
export function reflects(record: RecordDto, outcome: ReviewOutcome): boolean {
  if (outcome.kind === 'deleted') return false;
  const changes = outcome.changes;
  if (outcome.kind === 'status' && record.status !== outcome.record.status)
    return false;
  return (
    !changes ||
    (record.title === changes.title &&
      record.description === changes.description &&
      record.categories.join() === changes.categories.join())
  );
}

export { canReparse } from './record-status';

/** What the inbox says after sending documents back to the parser. */
export function reparseNotice(result: ReparseUploadsResponse): string {
  const sent = result.requeued.length;
  const skipped = result.skipped.length;
  const parts: string[] = [];
  if (sent)
    parts.push(
      `${sent} document${sent === 1 ? '' : 's'} sent back to the AI: reading starts now.`,
    );
  if (skipped)
    parts.push(
      `${skipped} ${skipped === 1 ? 'was' : 'were'} left as ${skipped === 1 ? 'it was' : 'they were'}: not waiting for review or failed.`,
    );
  return parts.join(' ');
}

/** The inbox of uploaded documents, filterable, with a details popup per parsed record. */
@Component({
  selector: 'app-inbox-page',
  // Ptera's area: the character theme re-tints the accent for everything inside.
  host: { 'data-character': 'ptera', class: 'inbox' },
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    AiTool,
    CategoryFilter,
    DatePipe,
    LinkChecks,
    QueueBanner,
    ReviewPanel,
    RouterLink,
    UiAlert,
    UiBadge,
    UiButton,
    UiCellDef,
    UiConfirmDialog,
    UiDropdown,
    UiFormField,
    UiIcon,
    UiInput,
    UiPageHeader,
    UiStatusDot,
    UiTable,
  ],
  templateUrl: './inbox-page.html',
  styleUrl: './inbox-page.css',
})
export class InboxPage {
  private readonly api = inject(ReviewApi);
  private readonly ingestion = inject(IngestionApi);
  private readonly banner = viewChild.required(QueueBanner);
  private readonly linkChecks = viewChild(LinkChecks);
  protected readonly store = inject(CategoryStore);
  protected readonly reclassification = inject(ReclassificationState);
  protected readonly reclassifyState = computed(() =>
    reclassifyStartState(this.reclassification.value()),
  );
  protected readonly confirmingReclassify = signal(false);
  /** Category suggestions waiting for a decision; a hint, so errors just hide it. */
  protected readonly pendingSuggestions = computed(() =>
    this.store.suggested.hasValue() ? this.store.suggested.value().length : 0,
  );
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly params = this.route.snapshot.queryParamMap;

  // Filters live in the URL, so a filtered view can be bookmarked or shared.
  protected readonly searchText = signal(this.params.get('q') ?? '');
  protected readonly search = signal(this.searchText());
  /** Opens on the review queue; "Any status" shows everything. */
  protected readonly status = signal<RecordStatus | null>(
    statusFromParam(this.params.get('status')),
  );
  /** Records with findings of a later check against new categories (or being checked). */
  protected readonly historical = signal<HistoricalStatus | null>(
    (HISTORICAL_STATUSES as readonly string[]).includes(
      this.params.get('historical') ?? '',
    )
      ? (this.params.get('historical') as HistoricalStatus)
      : null,
  );
  /** Selected category ids; each includes its subcategories. */
  protected readonly categories = signal<string[]>(
    (this.params.get('category') ?? '').split(',').filter(Boolean),
  );
  /** Only the records confirmed on their own, with nothing to check. */
  protected readonly autoConfirmed = signal(this.params.get('auto') === '1');
  protected readonly fileFormat = signal<FileFormat | null>(
    (this.params.get('fileFormat') as FileFormat) || null,
  );
  protected readonly uploadedFrom = signal(
    this.params.get('uploadedFrom') ?? '',
  );
  protected readonly uploadedTo = signal(this.params.get('uploadedTo') ?? '');
  protected readonly sort = signal<UiTableSort | null>({
    key: this.params.get('sort') ?? 'uploadedAt',
    direction: this.params.get('order') === 'asc' ? 'asc' : 'desc',
  });
  protected readonly page = signal(Number(this.params.get('page') ?? 0) || 0);

  protected readonly selectedId = signal<string | null>(null);
  /** Upload ids of the rows ticked to be parsed again (kept across pages). */
  protected readonly picked = signal<readonly unknown[]>([]);
  protected readonly canReparse = canReparse;
  protected readonly pickLabel = (row: RecordDto) => `Select ${row.title}`;
  protected readonly confirmingReparse = signal(false);
  protected readonly reparsing = signal(false);
  protected readonly reparseMessage = signal<{
    tone: 'success' | 'danger';
    text: string;
  } | null>(null);
  protected readonly panelOpen = signal(false);
  protected readonly statusView = RECORD_STATUS_VIEW;
  protected readonly historicalView = HISTORICAL_STATUS_VIEW;
  protected readonly historicalOptions: UiOption<HistoricalStatus>[] =
    HISTORICAL_STATUSES.map((value) => ({
      value,
      label: HISTORICAL_STATUS_VIEW[value].label,
      tone: HISTORICAL_STATUS_VIEW[value].tone,
    }));
  protected readonly moduleLabels = MODULE_LABELS;
  protected readonly defaultStatus = DEFAULT_STATUS;
  private readonly destroyRef = inject(DestroyRef);
  private catchUp?: ReturnType<typeof setTimeout>;
  private runReload?: ReturnType<typeof setTimeout>;
  protected readonly pageSize = PAGE_SIZE;

  protected readonly statusOptions: UiOption<RecordStatus>[] =
    RECORD_STATUSES.map((value) => ({
      value,
      label: RECORD_STATUS_VIEW[value].label,
      tone: RECORD_STATUS_VIEW[value].tone,
    }));
  protected readonly formatOptions: UiOption<FileFormat>[] = FILE_FORMATS.map(
    (value) => ({ value, label: value }),
  );

  protected readonly columns: UiTableColumn[] = [
    { key: 'title', header: 'Title', sortable: true },
    { key: 'description', header: 'Description' },
    { key: 'categories', header: 'Categories' },
    { key: 'suggested', header: 'Suggested categories' },
    { key: 'status', header: 'Status', width: '11rem' },
    { key: 'uploadedAt', header: 'Uploaded', sortable: true, width: '9rem' },
    { key: 'parsedAt', header: 'Parsed', sortable: true, width: '9rem' },
    { key: 'details', header: 'Actions', align: 'center', width: '8rem' },
  ];

  /** Every filter but the category one: what the category counts are computed under. */
  private readonly otherFilters = computed<CategoryCountsQuery>(() => ({
    q: this.search() || undefined,
    status: this.status() ?? undefined,
    historical: this.historical() ?? undefined,
    autoConfirmed: this.autoConfirmed() || undefined,
    fileFormat: this.fileFormat() ?? undefined,
    uploadedFrom: this.uploadedFrom() || undefined,
    uploadedTo: this.uploadedTo() || undefined,
  }));

  protected readonly query = computed<ListRecordsQuery>(() => ({
    ...this.otherFilters(),
    documentCategory: this.categories().length ? this.categories() : undefined,
    sort: (this.sort()?.key as SortKey) ?? 'uploadedAt',
    order: this.sort()?.direction ?? 'desc',
    limit: PAGE_SIZE,
    offset: this.page() * PAGE_SIZE,
  }));

  protected readonly records = rxResource({
    params: () => this.query(),
    stream: ({ params }) => this.api.list(params),
  });
  /** How many records each category would show; a hint, so errors just hide the counts. */
  protected readonly categoryCounts = rxResource({
    params: () => this.otherFilters(),
    stream: ({ params }) => this.api.categoryCounts(params),
  });
  protected readonly rows = computed<RecordDto[]>(
    () => this.records.value()?.items ?? [],
  );
  protected readonly total = computed(() => this.records.value()?.total ?? 0);
  /**
   * The next record waiting for review after the one open, in the order
   * shown: what Confirm and next opens.
   */
  protected readonly nextRecordId = computed(() => {
    const rows = this.rows();
    const index = rows.findIndex((row) => row.id === this.selectedId());
    return (
      rows.find(
        (row, i) =>
          i > index && row.status === 'PARSED' && row.id !== this.selectedId(),
      )?.id ?? null
    );
  });
  protected readonly showingQueue = computed(
    () => this.status() === DEFAULT_STATUS,
  );
  protected readonly hasFilters = computed(
    () =>
      !!(
        this.search() ||
        this.status() !== DEFAULT_STATUS ||
        this.historical() ||
        this.autoConfirmed() ||
        this.categories().length ||
        this.fileFormat() ||
        this.uploadedFrom() ||
        this.uploadedTo()
      ),
  );

  constructor() {
    this.destroyRef.onDestroy(() => {
      clearTimeout(this.catchUp);
      clearTimeout(this.runReload);
    });
    // A reclassification ended: its findings are in the inbox now.
    effect(() => {
      if (!this.reclassification.finished()) return;
      untracked(() => {
        this.records.reload();
        this.store.reload();
      });
    });
    // Debounce typing in the search box.
    effect((onCleanup) => {
      const text = this.searchText().trim();
      const timer = setTimeout(() => this.search.set(text), 300);
      onCleanup(() => clearTimeout(timer));
    });
    // A filter change goes back to the first page (but keep the page from the URL on load).
    let firstRun = true;
    effect(() => {
      this.search();
      this.status();
      this.historical();
      this.autoConfirmed();
      this.categories();
      this.fileFormat();
      this.uploadedFrom();
      this.uploadedTo();
      if (!firstRun)
        untracked(() => {
          this.page.set(0);
          this.picked.set([]);
        });
      firstRun = false;
    });
    // Mirror the query in the URL.
    effect(() => {
      const query = this.query();
      void this.router.navigate([], {
        relativeTo: this.route,
        queryParams: {
          q: query.q,
          status: statusToParam(this.status()),
          historical: this.historical() ?? undefined,
          auto: this.autoConfirmed() ? '1' : undefined,
          category: this.categories().join(',') || undefined,
          fileFormat: query.fileFormat,
          uploadedFrom: query.uploadedFrom,
          uploadedTo: query.uploadedTo,
          sort: query.sort === 'uploadedAt' ? undefined : query.sort,
          order: query.order === 'desc' ? undefined : query.order,
          page: this.page() || undefined,
        },
        replaceUrl: true,
      });
    });
  }

  protected openReview(row: RecordDto): void {
    this.selectedId.set(row.id);
    this.panelOpen.set(true);
  }

  protected showNext(): void {
    const next = this.nextRecordId();
    if (next) this.selectedId.set(next);
  }

  protected showAll(): void {
    this.status.set(null);
  }

  /** The documents a later check found new categories for, in any status. */
  protected showHistorical(): void {
    this.status.set(null);
    this.historical.set('PENDING_REVIEW');
  }

  /** What was confirmed on its own: to look over, and send back if needed. */
  protected showAutoConfirmed(): void {
    this.status.set('CONFIRMED');
    this.autoConfirmed.set(true);
  }

  protected async startReclassify(): Promise<void> {
    await this.reclassification.start();
    this.confirmingReclassify.set(false);
    this.records.reload();
  }

  /**
   * Shows your change at once, then reloads once the review service has it:
   * it learns about document edits through an event, a moment later, so the
   * inbox checks the record until it reflects the change (or gives up after
   * a few seconds and reloads anyway).
   */
  protected onChanged(outcome: ReviewOutcome): void {
    this.records.update((page) => {
      if (!page) return page;
      if (outcome.kind === 'deleted')
        return {
          ...page,
          items: page.items.filter((row) => row.id !== outcome.recordId),
          total: Math.max(0, page.total - 1),
        };
      const changes: DocumentChanges | undefined = outcome.changes;
      return {
        ...page,
        items: page.items.map((row) => {
          let next = row;
          if (outcome.kind === 'status' && row.id === outcome.record.id)
            next = { ...next, status: outcome.record.status };
          if (changes && row.uploadId === changes.uploadId)
            next = {
              ...next,
              title: changes.title,
              description: changes.description,
              categories: changes.categories,
              suggestedCategories: next.suggestedCategories.filter(
                (id) => !changes.categories.includes(id),
              ),
            };
          return next;
        }),
      };
    });
    this.store.reload();
    this.waitForInbox(outcome);
  }

  /**
   * A parse run ended: the review service hears about each parsed document
   * through an event, so the inbox reloads now and once more a moment later.
   */
  /** One document sent back to the parser from its panel: read it now. */
  protected onReparsed(): void {
    void this.banner().runNow();
    this.onRunFinished();
  }

  protected onRunFinished(): void {
    const reload = () => {
      this.records.reload();
      this.categoryCounts.reload();
      this.store.reload();
      this.linkChecks()?.reload();
    };
    reload();
    clearTimeout(this.runReload);
    this.runReload = setTimeout(reload, RUN_RELOAD_DELAY_MS);
  }

  /**
   * Sends the ticked documents back to the parser. The inbox shows them as
   * waiting at once; the review service hears it through an event, so the
   * list reloads now and once more a moment later.
   */
  protected async reparsePicked(): Promise<void> {
    const uploadIds = this.picked().map(String);
    if (!uploadIds.length || this.reparsing()) return;
    this.reparsing.set(true);
    try {
      const result = await firstValueFrom(
        this.ingestion.reparseUploads(uploadIds),
      );
      const sent = new Set(result.requeued);
      this.records.update((page) =>
        page
          ? {
              ...page,
              items: page.items.map((row) =>
                sent.has(row.uploadId)
                  ? {
                      ...row,
                      status: 'UPLOADED',
                      category: null,
                      targetKey: null,
                      categories: [],
                      suggestedCategories: [],
                      parsedAt: null,
                    }
                  : row,
              ),
            }
          : page,
      );
      this.picked.set([]);
      this.confirmingReparse.set(false);
      this.reparseMessage.set({
        tone: 'success',
        text: reparseNotice(result),
      });
      if (sent.size) void this.banner().runNow();
      this.onRunFinished();
    } catch {
      this.reparseMessage.set({
        tone: 'danger',
        text: 'The documents could not be sent back to the parser. Is the ingestion service running?',
      });
      this.confirmingReparse.set(false);
    } finally {
      this.reparsing.set(false);
    }
  }

  private waitForInbox(outcome: ReviewOutcome, attempt = 0): void {
    clearTimeout(this.catchUp);
    const recordId =
      outcome.kind === 'deleted'
        ? null
        : outcome.kind === 'status'
          ? outcome.record.id
          : this.rows().find((row) => row.uploadId === outcome.changes.uploadId)
              ?.id;
    const reload = () => {
      this.records.reload();
      this.categoryCounts.reload();
    };
    // A deletion is ours alone to show; a status change is already stored.
    if (!recordId || attempt >= CATCH_UP_DELAYS.length) {
      reload();
      return;
    }
    this.catchUp = setTimeout(async () => {
      try {
        const record = await firstValueFrom(this.api.get(recordId));
        if (reflects(record, outcome)) reload();
        else this.waitForInbox(outcome, attempt + 1);
      } catch {
        reload();
      }
    }, CATCH_UP_DELAYS[attempt]);
  }

  protected clearFilters(): void {
    this.searchText.set('');
    this.search.set('');
    this.status.set(DEFAULT_STATUS);
    this.historical.set(null);
    this.autoConfirmed.set(false);
    this.categories.set([]);
    this.fileFormat.set(null);
    this.uploadedFrom.set('');
    this.uploadedTo.set('');
  }

  protected inputValue(event: Event): string {
    return (event.target as HTMLInputElement).value;
  }
}
