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
import { ActivatedRoute, Router } from '@angular/router';
import type {
  FileFormat,
  ListRecordsQuery,
  RecordDto,
  RecordStatus,
} from '@life-island/contracts';
import {
  CATEGORY_LABELS,
  FILE_FORMATS,
  RECORD_STATUSES,
} from '@life-island/contracts/constants';
import {
  UiAlert,
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
import { RecordDialog } from './record-dialog';
import { HAS_DETAILS, RECORD_STATUS_VIEW } from './record-status';

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
    RecordDialog,
    UiAlert,
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
  protected readonly statusView = RECORD_STATUS_VIEW;
  protected readonly pageSize = PAGE_SIZE;

  protected readonly statusOptions: UiOption<RecordStatus>[] =
    RECORD_STATUSES.map((value) => ({
      value,
      label: RECORD_STATUS_VIEW[value].label,
      tone: RECORD_STATUS_VIEW[value].tone,
    }));
  protected readonly categoryOptions: UiOption<string>[] = Object.entries(
    CATEGORY_LABELS,
  ).map(([value, label]) => ({ value, label }));
  protected readonly formatOptions: UiOption<FileFormat>[] = FILE_FORMATS.map(
    (value) => ({ value, label: value }),
  );

  protected readonly columns: UiTableColumn[] = [
    { key: 'title', header: 'Title', sortable: true },
    { key: 'description', header: 'Description' },
    { key: 'status', header: 'Status', width: '12rem' },
    { key: 'uploadedAt', header: 'Uploaded', sortable: true, width: '10rem' },
    { key: 'parsedAt', header: 'Parsed', sortable: true, width: '10rem' },
    { key: 'details', header: 'Details', align: 'center', width: '6rem' },
  ];

  protected readonly query = computed<ListRecordsQuery>(() => ({
    q: this.search() || undefined,
    status: this.status() ?? undefined,
    category: this.category() ?? undefined,
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
          category: query.category,
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

  protected hasDetails(row: RecordDto): boolean {
    return HAS_DETAILS.includes(row.status);
  }

  protected openDetails(row: RecordDto): void {
    this.selectedId.set(row.id);
    this.dialogOpen.set(true);
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
