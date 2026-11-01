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
} from '@angular/core';
import { rxResource } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import type {
  CategoryCountsQuery,
  FileFormat,
  ListRecordsQuery,
  RecordDto,
  RecordStatus,
} from '@life-island/contracts';
import {
  FILE_FORMATS,
  MODULE_LABELS,
  RECORD_STATUSES,
} from '@life-island/contracts/constants';
import {
  UiAlert,
  UiBadge,
  UiButton,
  UiCellDef,
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
import { ReviewApi } from '../api/review-api';
import { CategoryStore } from '../categories/category-store';
import { CategoryFilter } from './category-filter';
import { firstValueFrom } from 'rxjs';
import type { DocumentChanges } from './document-changes';
import { QueueBanner } from './queue-banner';
import { RECORD_STATUS_VIEW } from './record-status';
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

/** The inbox of uploaded documents, filterable, with a details popup per parsed record. */
@Component({
  selector: 'app-inbox-page',
  // Ptera's area: the character theme re-tints the accent for everything inside.
  host: { 'data-character': 'ptera', class: 'inbox' },
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CategoryFilter,
    DatePipe,
    QueueBanner,
    ReviewPanel,
    RouterLink,
    UiAlert,
    UiBadge,
    UiButton,
    UiCellDef,
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
  protected readonly store = inject(CategoryStore);
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
  /** Selected category ids; each includes its subcategories. */
  protected readonly categories = signal<string[]>(
    (this.params.get('category') ?? '').split(',').filter(Boolean),
  );
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
  protected readonly panelOpen = signal(false);
  protected readonly statusView = RECORD_STATUS_VIEW;
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
      this.categories();
      this.fileFormat();
      this.uploadedFrom();
      this.uploadedTo();
      if (!firstRun) untracked(() => this.page.set(0));
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
  protected onRunFinished(): void {
    const reload = () => {
      this.records.reload();
      this.categoryCounts.reload();
      this.store.reload();
    };
    reload();
    clearTimeout(this.runReload);
    this.runReload = setTimeout(reload, RUN_RELOAD_DELAY_MS);
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
    this.categories.set([]);
    this.fileFormat.set(null);
    this.uploadedFrom.set('');
    this.uploadedTo.set('');
  }

  protected inputValue(event: Event): string {
    return (event.target as HTMLInputElement).value;
  }
}
