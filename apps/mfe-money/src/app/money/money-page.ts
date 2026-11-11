import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
} from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import {
  ACCOUNT_KIND_LABELS,
  MONEY_CATEGORIES,
  MONEY_CATEGORY_LABELS,
  type AccountDto,
  type MoneyCategory,
  type MoneyOverviewDto,
  type SpendingReviewDto,
  type TransactionDto,
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
  LiBars,
  LiRecordDialog,
  LiTabs,
  RecordEditor,
  dateText,
  errorText,
  euro,
  liOptions,
  localToday,
  monthText,
  percent,
  type LiBar,
  type LiField,
  type LiTab,
} from '@life-island/records-ui';
import { AiTool } from '@life-island/settings-ui';
import { MoneyApi } from '../api/money-api';
import { parseBankCsv, type BankCsv } from './bank-csv';

type MoneyTab = 'overview' | 'movements' | 'budgets' | 'recurring' | 'review';
const TABS: readonly MoneyTab[] = [
  'overview',
  'movements',
  'budgets',
  'recurring',
  'review',
];
const SERVICE = 'svc-money';
const PAGE = 50;

const ACCOUNT_FIELDS: readonly LiField[] = [
  {
    key: 'name',
    label: 'Name',
    type: 'text',
    required: true,
    placeholder: 'Fineco current account',
  },
  { key: 'institution', label: 'Bank', type: 'text' },
  {
    key: 'kind',
    label: 'Kind',
    type: 'select',
    required: true,
    options: liOptions(ACCOUNT_KIND_LABELS),
  },
  {
    key: 'openingBalance',
    label: 'Balance on the start date',
    type: 'money',
    hint: 'Negative for a debt',
  },
  {
    key: 'openingDate',
    label: 'Start date',
    type: 'date',
    required: true,
    hint: 'Movements from this day on add up to the balance',
  },
  {
    key: 'archived',
    label: 'Closed: keep its history, leave it out of the total',
    type: 'checkbox',
    wide: true,
  },
  { key: 'notes', label: 'Notes', type: 'textarea' },
];

const BUDGET_FIELDS: readonly LiField[] = [
  {
    key: 'category',
    label: 'Category',
    type: 'select',
    required: true,
    fixedOnEdit: true,
    options: liOptions(MONEY_CATEGORY_LABELS).filter(
      (o) => !['salary', 'other-income', 'savings'].includes(o.value),
    ),
  },
  {
    key: 'monthlyLimit',
    label: 'Monthly limit',
    type: 'money',
    required: true,
  },
];

/**
 * Money (Spino): your accounts and what goes in and out of them, monthly
 * budgets per category, the charges that come back every month and a review
 * of your spending.
 */
@Component({
  selector: 'money-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    AiTool,
    LiBars,
    LiRecordDialog,
    LiTabs,
    UiAiPanel,
    UiAiStatus,
    UiAlert,
    UiButton,
    UiCard,
    UiDialog,
    UiEmptyState,
    UiIcon,
    UiPageHeader,
  ],
  host: { 'data-character': 'spino', class: 'money' },
  templateUrl: './money-page.html',
  styleUrl: './money-page.css',
})
export class MoneyPage {
  private readonly api = inject(MoneyApi);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  protected readonly data = signal<MoneyOverviewDto | null>(null);
  protected readonly error = signal<string | null>(null);
  protected readonly tab = signal<string>(this.initialTab());
  protected readonly euro = euro;
  protected readonly dateText = dateText;
  protected readonly monthText = monthText;
  protected readonly percent = percent;
  protected readonly accountFields = ACCOUNT_FIELDS;
  protected readonly budgetFields = BUDGET_FIELDS;
  protected readonly categoryOptions = liOptions(MONEY_CATEGORY_LABELS);

  protected readonly accounts = new RecordEditor(
    this.api,
    'accounts',
    () => this.load(),
    SERVICE,
  );
  protected readonly budgets = new RecordEditor(
    this.api,
    'budgets',
    () => this.load(),
    SERVICE,
  );
  protected readonly movements = new RecordEditor(
    this.api,
    'transactions',
    () => this.load(),
    SERVICE,
  );

  // Movements: filters and paging
  protected readonly accountFilter = signal<string | null>(null);
  protected readonly categoryFilter = signal<string | null>(null);
  protected readonly search = signal('');
  protected readonly shown = signal(PAGE);

  // CSV import
  protected readonly importOpen = signal(false);
  protected readonly importAccount = signal<string | null>(null);
  protected readonly csv = signal<BankCsv | null>(null);
  protected readonly importing = signal(false);
  protected readonly importResult = signal<string | null>(null);

  // The review
  protected readonly question = signal('');
  protected readonly asking = signal(false);
  protected readonly reviewStatus = signal<'idle' | 'done' | 'error'>('idle');
  protected readonly shownReview = signal<string | null>(null);

  protected readonly tabs = computed<LiTab[]>(() => {
    const d = this.data();
    return [
      { id: 'overview', label: 'Overview', icon: 'chart' },
      { id: 'movements', label: 'Movements', icon: 'layers' },
      {
        id: 'budgets',
        label: 'Budgets',
        icon: 'sliders',
        count: d?.budgets.filter((b) => b.share > 1).length,
      },
      { id: 'recurring', label: 'Recurring', icon: 'refresh' },
      { id: 'review', label: 'Review', icon: 'sparkles' },
    ];
  });

  protected readonly accountName = computed(() => {
    const names = new Map(
      (this.data()?.accounts ?? []).map((a) => [a.id, a.name]),
    );
    return (id: string) => names.get(id) ?? '—';
  });

  /** The movement form: the account list depends on the data. */
  protected readonly movementFields = computed<LiField[]>(() => [
    {
      key: 'accountId',
      label: 'Account',
      type: 'select',
      required: true,
      options: (this.data()?.accounts ?? [])
        .filter((a) => !a.archived)
        .map((a) => ({ value: a.id, label: a.name })),
    },
    { key: 'date', label: 'Date', type: 'date', required: true },
    {
      key: 'amount',
      label: 'Amount',
      type: 'money',
      required: true,
      hint: 'Negative for money out, e.g. -45.90',
    },
    {
      key: 'description',
      label: 'Description',
      type: 'text',
      required: true,
      wide: true,
    },
    {
      key: 'category',
      label: 'Category',
      type: 'select',
      options: this.categoryOptions,
      emptyLabel: 'Guess from the description',
    },
    { key: 'notes', label: 'Notes', type: 'textarea' },
  ]);

  protected readonly filtered = computed(() => {
    const all = this.data()?.transactions ?? [];
    const account = this.accountFilter();
    const category = this.categoryFilter();
    const text = this.search().trim().toLowerCase();
    return all.filter(
      (t) =>
        (!account || t.accountId === account) &&
        (!category || t.category === category) &&
        (!text || t.description.toLowerCase().includes(text)),
    );
  });

  protected readonly filteredTotal = computed(() =>
    this.filtered().reduce((s, t) => s + t.amount, 0),
  );

  protected readonly monthBars = computed<LiBar[]>(() =>
    (this.data()?.months ?? []).map((m) => ({
      label: monthText(m.month, true),
      value: m.spending,
      target: m.income,
      tone: m.spending > m.income && m.income > 0 ? 'danger' : 'accent',
      title: `${monthText(m.month)}: out ${euro(m.spending, false)}, in ${euro(m.income, false)}`,
    })),
  );

  /** Categories with a budget are left out of the "Add budget" choices. */
  protected readonly topCategories = computed(() =>
    (this.data()?.categories ?? []).slice(0, 8),
  );

  protected readonly review = computed<SpendingReviewDto | null>(() => {
    const reviews = this.data()?.reviews ?? [];
    return (
      reviews.find((r) => r.id === this.shownReview()) ?? reviews[0] ?? null
    );
  });

  constructor() {
    this.load();
  }

  private initialTab(): MoneyTab {
    const tab = this.route.snapshot.queryParamMap.get('tab') as MoneyTab | null;
    return tab && TABS.includes(tab) ? tab : 'overview';
  }

  protected setTab(tab: string): void {
    this.tab.set(tab);
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { tab: tab === 'overview' ? null : tab },
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
        this.error.set(errorText(error, 'Could not load your money.', SERVICE)),
    });
  }

  protected category(c: string): string {
    return MONEY_CATEGORY_LABELS[c as MoneyCategory] ?? c;
  }

  protected kind(account: AccountDto): string {
    return ACCOUNT_KIND_LABELS[account.kind] ?? account.kind;
  }

  protected addAccount(): void {
    this.accounts.add({
      kind: 'current',
      openingBalance: 0,
      openingDate: localToday(),
    });
  }

  protected addMovement(): void {
    const first =
      this.accountFilter() ??
      this.data()?.accounts.find((a) => !a.archived)?.id;
    this.movements.add({ accountId: first, date: localToday() });
  }

  protected editMovement(t: TransactionDto): void {
    this.movements.edit(t);
  }

  protected addBudget(category?: string): void {
    this.budgets.add({ category });
  }

  protected budgetTone(share: number): string {
    return share > 1 ? 'danger' : share > 0.85 ? 'warning' : 'good';
  }

  // CSV import

  protected openImport(): void {
    this.importAccount.set(
      this.accountFilter() ??
        this.data()?.accounts.find((a) => !a.archived)?.id ??
        null,
    );
    this.csv.set(null);
    this.importResult.set(null);
    this.importOpen.set(true);
  }

  protected async readFile(event: Event): Promise<void> {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (!file) return;
    const buffer = await file.arrayBuffer();
    // Most Italian banks still export in Windows-1252.
    let text = new TextDecoder('utf-8').decode(buffer);
    if (text.includes('�'))
      text = new TextDecoder('windows-1252').decode(buffer);
    this.csv.set(parseBankCsv(text));
  }

  protected runImport(): void {
    const csv = this.csv();
    const accountId = this.importAccount();
    if (!csv?.rows.length || !accountId) return;
    this.importing.set(true);
    this.api.importTransactions({ accountId, rows: csv.rows }).subscribe({
      next: (result) => {
        this.importing.set(false);
        this.importResult.set(
          `${result.added} movement${result.added === 1 ? '' : 's'} added` +
            (result.skipped ? `, ${result.skipped} already there.` : '.'),
        );
        this.csv.set(null);
        this.load();
      },
      error: (error: unknown) => {
        this.importing.set(false);
        this.importResult.set(
          errorText(error, 'Could not import the file.', SERVICE),
        );
      },
    });
  }

  // The review

  protected ask(): void {
    this.asking.set(true);
    this.reviewStatus.set('idle');
    this.api
      .writeReview({ question: this.question().trim() || null })
      .subscribe({
        next: (review) => {
          this.asking.set(false);
          this.reviewStatus.set('done');
          this.shownReview.set(review.id);
          this.question.set('');
          this.load();
        },
        error: (error: unknown) => {
          this.asking.set(false);
          this.reviewStatus.set('error');
          this.error.set(
            errorText(error, 'Could not write the review.', SERVICE),
          );
        },
      });
  }

  protected removeReview(id: string): void {
    this.api.removeReview(id).subscribe({
      next: () => {
        this.shownReview.set(null);
        this.load();
      },
      error: (error: unknown) =>
        this.error.set(errorText(error, 'Could not remove it.', SERVICE)),
    });
  }

  protected readonly allCategories = MONEY_CATEGORIES;
  protected readonly pageSize = PAGE;
}
