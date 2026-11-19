import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import {
  ACCOUNT_KIND_LABELS,
  MONEY_CATEGORIES,
  MONEY_CATEGORY_LABELS,
  MONEY_CHANNEL_LABELS,
  moneyChannel,
  type AccountDto,
  type MoneyCategory,
  type MoneyOverviewDto,
  type MovementPaidItemDto,
  type SpendingReviewDto,
  type TransactionDto,
} from '@life-island/contracts';
import {
  UiAiPanel,
  UiAiStatus,
  UiAlert,
  UiButton,
  UiCard,
  UiColumnChart,
  UiDialog,
  UiEmptyState,
  UiIcon,
  UiPageHeader,
  UiProgressBar,
  type UiChartSeries,
  type UiProgressTone,
} from '@life-island/design-system';
import {
  LiDelta,
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
  type LiField,
  type LiTab,
  LiNeedsYou,
  urlTab,
} from '@life-island/records-ui';
import { AiTool } from '@life-island/settings-ui';
import { MoneyApi } from '../api/money-api';
import { parseBankCsv, type BankCsv } from './bank-csv';
import { MoneyMatch } from './money-match';
import { MoneyReceipt } from './money-receipt';

type MoneyTab =
  'overview' | 'movements' | 'match' | 'budgets' | 'recurring' | 'review';
const TABS: readonly MoneyTab[] = [
  'overview',
  'movements',
  'match',
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
    LiNeedsYou,
    UiProgressBar,
    AiTool,
    UiColumnChart,
    LiDelta,
    LiRecordDialog,
    LiTabs,
    MoneyMatch,
    MoneyReceipt,
    RouterLink,
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

  protected readonly data = signal<MoneyOverviewDto | null>(null);
  protected readonly error = signal<string | null>(null);
  protected readonly tab = urlTab(TABS, 'overview');
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
  /** `YYYY-MM` from a month of the charts, or null for all. */
  protected readonly monthFilter = signal<string | null>(null);
  protected readonly search = signal('');
  protected readonly shown = signal(PAGE);

  // Receipts and notes: a movement's, or a new expense's
  protected readonly receiptOpen = signal(false);
  protected readonly receiptMovement = signal<TransactionDto | null>(null);

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
      { id: 'match', label: 'To match', icon: 'check' },
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

  /** What each movement paid in other areas, by movement id (Money matching). */
  protected readonly paidOf = computed(() => {
    const map = new Map<string, MovementPaidItemDto[]>();
    for (const item of this.data()?.paidItems ?? [])
      map.set(item.movementId, [...(map.get(item.movementId) ?? []), item]);
    return map;
  });

  /** The movement dialog warns when the movement paid something elsewhere. */
  protected readonly movementIntro = computed(() => {
    const id = this.movements.value()?.['id'];
    const items = typeof id === 'string' ? this.paidOf().get(id) : undefined;
    if (!items?.length) return '';
    const what = items.map((i) => `${i.title} (${i.areaName})`).join(', ');
    return `This movement paid ${what}. Deleting it, or changing its amount or direction so it no longer covers that, undoes the match and the area forgets the payment.`;
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
    const month = this.monthFilter();
    const text = this.search().trim().toLowerCase();
    return all.filter(
      (t) =>
        (!account || t.accountId === account) &&
        (!month || t.date.startsWith(month)) &&
        (!category ||
          t.category === category ||
          t.splits.some((p) => p.category === category)) &&
        (!text ||
          t.description.toLowerCase().includes(text) ||
          (t.notes ?? '').toLowerCase().includes(text)),
    );
  });

  protected readonly filteredTotal = computed(() =>
    this.filtered().reduce((s, t) => s + t.amount, 0),
  );

  /** In and out per month, with what was kept as a line. */
  protected readonly flow = computed(() => {
    const months = this.data()?.months ?? [];
    const kept = months.reduce((s, m) => s + m.net, 0);
    const came = months.reduce((s, m) => s + m.income, 0);
    return {
      buckets: months.map((m) => m.month),
      series: [
        {
          id: 'in',
          label: 'Came in',
          color: 'var(--viz-in)',
          values: months.map((m) => m.income),
        },
        {
          id: 'out',
          label: 'Went out',
          color: 'var(--viz-out)',
          values: months.map((m) => m.spending),
        },
      ] satisfies UiChartSeries[],
      line: {
        id: 'kept',
        label: 'Kept',
        color: 'var(--viz-kept)',
        values: months.map((m) => m.net),
      } satisfies UiChartSeries,
      kept,
      share: came > 0 ? kept / came : null,
      short: months.filter((m) => m.net < 0).length,
    };
  });

  /**
   * What went out each month by category: the five biggest over the year in
   * the palette's order, the rest as "Other", so a jump shows where it came
   * from. A column opens that month's movements.
   */
  protected readonly spendingMix = computed(() => {
    const months = this.data()?.months ?? [];
    const totals = new Map<MoneyCategory, number>();
    for (const m of months)
      for (const [c, v] of Object.entries(m.spendingBy) as [
        MoneyCategory,
        number,
      ][])
        totals.set(c, (totals.get(c) ?? 0) + v);
    const top = [...totals.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([c]) => c);
    const series: UiChartSeries[] = top.map((c, i) => ({
      id: c,
      label: MONEY_CATEGORY_LABELS[c],
      color: `var(--viz-${i + 1})`,
      values: months.map((m) => m.spendingBy[c] ?? null),
    }));
    if (totals.size > top.length)
      series.push({
        id: 'other',
        label: 'Other',
        color: 'var(--viz-other)',
        values: months.map(
          (m) =>
            Math.round(
              (m.spending -
                top.reduce((s, c) => s + (m.spendingBy[c] ?? 0), 0)) *
                100,
            ) / 100 || null,
        ),
      });
    return { buckets: months.map((m) => m.month), series };
  });

  /**
   * Purchases (groceries, shopping, health…) month by month, online and in a
   * shop. What you set on a movement wins; otherwise the shop's name tells.
   */
  protected readonly channelMix = computed(() => {
    const months = this.data()?.purchaseChannels ?? [];
    const online = months.reduce((s, m) => s + m.online, 0);
    const total = online + months.reduce((s, m) => s + m.store, 0);
    return {
      buckets: months.map((m) => m.month),
      series: [
        {
          id: 'online',
          label: MONEY_CHANNEL_LABELS.online,
          color: 'var(--viz-online)',
          values: months.map((m) => m.online || null),
        },
        {
          id: 'store',
          label: MONEY_CHANNEL_LABELS.store,
          color: 'var(--viz-store)',
          values: months.map((m) => m.store || null),
        },
      ] satisfies UiChartSeries[],
      online,
      total,
      share: total > 0 ? online / total : null,
    };
  });

  protected channelText(t: TransactionDto): string {
    return MONEY_CHANNEL_LABELS[moneyChannel(t)];
  }

  /** "Groceries + Shopping" for a movement split into parts. */
  protected categoryText(t: TransactionDto): string {
    const others = t.splits
      .map((p) => this.category(p.category))
      .filter((c) => c !== this.category(t.category));
    return [this.category(t.category), ...new Set(others)].join(' + ');
  }

  protected splitTitle(t: TransactionDto): string {
    if (!t.splits.length) return '';
    const rest =
      Math.abs(t.amount) - t.splits.reduce((s, p) => s + p.amount, 0);
    return [
      ...(rest > 0.004 ? [`${this.category(t.category)} ${euro(rest)}`] : []),
      ...t.splits.map((p) => `${this.category(p.category)} ${euro(p.amount)}`),
    ].join(', ');
  }

  /** Receipts and a note for a movement. */
  protected openReceipt(t: TransactionDto | null): void {
    this.receiptMovement.set(t);
    this.receiptOpen.set(true);
  }

  protected readonly euroWhole = (v: number) => euro(v, false);
  protected readonly monthLong = (m: string) => monthText(m);
  protected readonly monthShort = (m: string) => monthText(m, true);

  /** A month of the chart: its movements. */
  protected seeMonth(month: string): void {
    this.monthFilter.set(month);
    this.categoryFilter.set(null);
    this.accountFilter.set(null);
    this.shown.set(PAGE);
    this.setTab('movements');
  }

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

  protected setTab(tab: string): void {
    this.tab.set(tab);
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

  /** Opens the movements of one category, this month's first. */
  protected seeCategory(category: string): void {
    this.categoryFilter.set(category);
    this.accountFilter.set(null);
    this.monthFilter.set(null);
    this.setTab('movements');
  }

  protected hasBudget(category: string): boolean {
    return !!this.data()?.budgets.some((b) => b.category === category);
  }

  protected addBudget(category?: string): void {
    this.budgets.add({ category });
  }

  protected budgetTone(share: number): UiProgressTone {
    return share > 1 ? 'danger' : share > 0.85 ? 'warning' : 'success';
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
