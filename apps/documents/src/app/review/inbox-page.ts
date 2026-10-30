import { DatePipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';
import { rxResource } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import type {
  FileFormat,
  ListRecordsQuery,
  RecordDto,
  RecordStatus,
} from '@life-island/contracts';
import {
  FILE_FORMATS,
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
import { DocumentEditor, type DocumentChanges } from './document-editor';
import { RecordDialog } from './record-dialog';
import { QueueBanner } from './queue-banner';
import { RECORD_STATUS_VIEW } from './record-status';

const PAGE_SIZE = 20;
type SortKey = NonNullable<ListRecordsQuery['sort']>;

/** The inbox of uploaded documents, filterable, with a details popup per parsed record. */
@Component({
  selector: 'app-inbox-page',
  // Ptera's area: the character theme re-tints the accent for everything inside.
  host: { 'data-character': 'ptera', class: 'inbox' },
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    DatePipe,
    DocumentEditor,
    QueueBanner,
    RecordDialog,
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
  protected readonly status = signal<RecordStatus | null>(
    (this.params.get('status') as RecordStatus) || null,
  );
  protected readonly category = signal<string | null>(
    this.params.get('category') || null,
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
  protected readonly dialogOpen = signal(false);
  protected readonly editorOpen = signal(false);
  protected readonly statusView = RECORD_STATUS_VIEW;
  protected readonly pageSize = PAGE_SIZE;

  protected readonly statusOptions: UiOption<RecordStatus>[] =
    RECORD_STATUSES.map((value) => ({
      value,
      label: RECORD_STATUS_VIEW[value].label,
      tone: RECORD_STATUS_VIEW[value].tone,
    }));
  protected readonly categoryOptions = computed<UiOption<string>[]>(() =>
    (this.store.confirmed.value() ?? []).map((category) => ({
      value: category.id,
      label: category.title,
    })),
  );
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
    { key: 'details', header: 'Actions', align: 'center', width: '6.5rem' },
  ];

  protected readonly query = computed<ListRecordsQuery>(() => ({
    q: this.search() || undefined,
    status: this.status() ?? undefined,
    documentCategory: this.category() ?? undefined,
    fileFormat: this.fileFormat() ?? undefined,
    uploadedFrom: this.uploadedFrom() || undefined,
    uploadedTo: this.uploadedTo() || undefined,
    sort: (this.sort()?.key as SortKey) ?? 'uploadedAt',
    order: this.sort()?.direction ?? 'desc',
    limit: PAGE_SIZE,
    offset: this.page() * PAGE_SIZE,
  }));

  protected readonly records = rxResource({
    params: () => this.query(),
    stream: ({ params }) => this.api.list(params),
  });
  protected readonly rows = computed<RecordDto[]>(
    () => this.records.value()?.items ?? [],
  );
  protected readonly total = computed(() => this.records.value()?.total ?? 0);
  protected readonly hasFilters = computed(
    () =>
      !!(
        this.search() ||
        this.status() ||
        this.category() ||
        this.fileFormat() ||
        this.uploadedFrom() ||
        this.uploadedTo()
      ),
  );

  constructor() {
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
      this.category();
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
          status: query.status,
          category: query.documentCategory,
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

  protected openDetails(row: RecordDto): void {
    this.selectedId.set(row.id);
    this.dialogOpen.set(true);
  }

  protected openEditor(row: RecordDto): void {
    this.selectedId.set(row.id);
    this.editorOpen.set(true);
  }

  /**
   * Shows your edits at once: the review service learns about them through an
   * event a moment later, so the list is reloaded shortly after.
   */
  protected applyChanges(changes: DocumentChanges): void {
    this.records.update((page) =>
      page
        ? {
            ...page,
            items: page.items.map((row) =>
              row.uploadId === changes.uploadId
                ? {
                    ...row,
                    title: changes.title,
                    description: changes.description,
                    categories: changes.categories,
                    suggestedCategories: row.suggestedCategories.filter(
                      (id) => !changes.categories.includes(id),
                    ),
                  }
                : row,
            ),
          }
        : page,
    );
    this.store.reload();
    setTimeout(() => this.records.reload(), 1500);
  }

  protected clearFilters(): void {
    this.searchText.set('');
    this.search.set('');
    this.status.set(null);
    this.category.set(null);
    this.fileFormat.set(null);
    this.uploadedFrom.set('');
    this.uploadedTo.set('');
  }

  protected inputValue(event: Event): string {
    return (event.target as HTMLInputElement).value;
  }
}
