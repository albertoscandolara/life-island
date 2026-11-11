import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
} from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import {
  GROCERY_CATEGORY_LABELS,
  type GroceriesOverviewDto,
  type GroceryItemCategory,
  type ShoppingItemDto,
  type ShoppingSuggestionDto,
} from '@life-island/contracts';
import {
  UiAiPanel,
  UiAiStatus,
  UiAlert,
  UiButton,
  UiCard,
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
  monthText,
  percent,
  type LiBar,
  type LiField,
  type LiTab,
} from '@life-island/records-ui';
import { AiTool } from '@life-island/settings-ui';
import { GroceriesApi } from '../api/groceries-api';

type GroceriesTab = 'list' | 'prices' | 'spending';
const TABS: readonly GroceriesTab[] = ['list', 'prices', 'spending'];
const SERVICE = 'svc-groceries';

const ITEM_FIELDS: readonly LiField[] = [
  { key: 'name', label: 'Item', type: 'text', required: true },
  {
    key: 'quantity',
    label: 'How much',
    type: 'text',
    placeholder: '2 packs, 1 kg…',
  },
  {
    key: 'category',
    label: 'Aisle',
    type: 'select',
    required: true,
    options: liOptions(GROCERY_CATEGORY_LABELS),
  },
  { key: 'done', label: 'In the cart', type: 'checkbox' },
];

/**
 * Groceries (Trice): your shopping list, what you buy and how its price
 * moves, where the money goes month by month, and a list suggested from your
 * receipts.
 */
@Component({
  selector: 'groceries-page',
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
    UiEmptyState,
    UiIcon,
    UiPageHeader,
  ],
  host: { 'data-character': 'trice', class: 'groceries' },
  templateUrl: './groceries-page.html',
  styleUrl: './groceries-page.css',
})
export class GroceriesPage {
  private readonly api = inject(GroceriesApi);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  protected readonly data = signal<GroceriesOverviewDto | null>(null);
  protected readonly error = signal<string | null>(null);
  protected readonly tab = signal<string>(this.initialTab());
  protected readonly euro = euro;
  protected readonly dateText = dateText;
  protected readonly percent = percent;
  protected readonly itemFields = ITEM_FIELDS;
  protected readonly categories = liOptions(GROCERY_CATEGORY_LABELS);
  protected readonly list = new RecordEditor(
    this.api,
    'list',
    () => this.load(),
    SERVICE,
  );

  protected readonly newItem = signal('');
  protected readonly search = signal('');

  protected readonly question = signal('');
  protected readonly asking = signal(false);
  protected readonly suggestStatus = signal<'idle' | 'done' | 'error'>('idle');
  protected readonly shownSuggestion = signal<string | null>(null);
  protected readonly applied = signal<string | null>(null);

  protected readonly tabs = computed<LiTab[]>(() => [
    {
      id: 'list',
      label: 'Shopping list',
      icon: 'check',
      count: (this.data()?.list ?? []).filter((i) => !i.done).length,
    },
    { id: 'prices', label: 'What you buy', icon: 'layers' },
    { id: 'spending', label: 'Spending', icon: 'chart' },
  ]);

  /** The list grouped by aisle, what is still to buy first. */
  protected readonly aisles = computed(() => {
    const groups = new Map<string, ShoppingItemDto[]>();
    for (const i of this.data()?.list ?? [])
      groups.set(i.category, [...(groups.get(i.category) ?? []), i]);
    return [...groups.entries()].map(([category, items]) => ({
      category,
      items: [...items].sort((a, b) => Number(a.done) - Number(b.done)),
    }));
  });
  protected readonly doneCount = computed(
    () => (this.data()?.list ?? []).filter((i) => i.done).length,
  );

  protected readonly items = computed(() => {
    const text = this.search().trim().toLowerCase();
    return (this.data()?.items ?? [])
      .filter((i) => !text || i.name.toLowerCase().includes(text))
      .slice(0, 100);
  });

  protected readonly monthBars = computed<LiBar[]>(() =>
    (this.data()?.months ?? []).map((m) => ({
      label: monthText(m.month, true),
      value: m.total,
      title: `${monthText(m.month)}: ${euro(m.total)} in ${m.receipts} receipts`,
    })),
  );

  protected readonly suggestion = computed<ShoppingSuggestionDto | null>(() => {
    const all = this.data()?.suggestions ?? [];
    return all.find((s) => s.id === this.shownSuggestion()) ?? all[0] ?? null;
  });

  /** Names already on the list, so a suggestion shows what it would add. */
  protected readonly onList = computed(
    () =>
      new Set(
        (this.data()?.list ?? [])
          .filter((i) => !i.done)
          .map((i) => i.name.toLowerCase()),
      ),
  );

  constructor() {
    this.load();
  }

  private initialTab(): GroceriesTab {
    const tab = this.route.snapshot.queryParamMap.get(
      'tab',
    ) as GroceriesTab | null;
    return tab && TABS.includes(tab) ? tab : 'list';
  }

  protected setTab(tab: string): void {
    this.tab.set(tab);
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { tab: tab === 'list' ? null : tab },
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
        this.error.set(
          errorText(error, 'Could not load your groceries.', SERVICE),
        ),
    });
  }

  protected category(c: string): string {
    return GROCERY_CATEGORY_LABELS[c as GroceryItemCategory] ?? c;
  }

  /** Adds what was typed, guessing the aisle from what you bought before. */
  protected quickAdd(): void {
    const name = this.newItem().trim();
    if (!name) return;
    const known = this.data()?.items.find(
      (i) => i.name.toLowerCase() === name.toLowerCase(),
    );
    this.newItem.set('');
    this.api
      .create('list', { name, category: known?.category ?? 'other' })
      .subscribe({
        next: () => this.load(),
        error: (error: unknown) =>
          this.error.set(errorText(error, 'Could not add it.', SERVICE)),
      });
  }

  protected toggle(item: ShoppingItemDto): void {
    this.data.update((d) =>
      d
        ? {
            ...d,
            list: d.list.map((i) =>
              i.id === item.id ? { ...i, done: !i.done } : i,
            ),
          }
        : d,
    );
    this.api.update('list', item.id, { done: !item.done }).subscribe({
      error: (error: unknown) => {
        this.error.set(errorText(error, 'Could not save it.', SERVICE));
        this.load();
      },
    });
  }

  protected clearDone(): void {
    this.api.clearDone().subscribe({
      next: () => this.load(),
      error: (error: unknown) =>
        this.error.set(errorText(error, 'Could not clear the list.', SERVICE)),
    });
  }

  protected suggest(): void {
    this.asking.set(true);
    this.suggestStatus.set('idle');
    this.applied.set(null);
    this.api.suggest({ question: this.question().trim() || null }).subscribe({
      next: (s) => {
        this.asking.set(false);
        this.suggestStatus.set('done');
        this.shownSuggestion.set(s.id);
        this.question.set('');
        this.load();
      },
      error: (error: unknown) => {
        this.asking.set(false);
        this.suggestStatus.set('error');
        this.error.set(errorText(error, 'Could not suggest a list.', SERVICE));
      },
    });
  }

  protected apply(s: ShoppingSuggestionDto, names?: string[]): void {
    this.api.apply(s.id, { names }).subscribe({
      next: ({ added }) => {
        this.applied.set(
          added
            ? `${added} item${added === 1 ? '' : 's'} added to the list.`
            : 'Everything is already on the list.',
        );
        this.load();
      },
      error: (error: unknown) =>
        this.error.set(errorText(error, 'Could not add them.', SERVICE)),
    });
  }

  protected removeSuggestion(id: string): void {
    this.api.removeSuggestion(id).subscribe({
      next: () => {
        this.shownSuggestion.set(null);
        this.load();
      },
      error: (error: unknown) =>
        this.error.set(errorText(error, 'Could not remove it.', SERVICE)),
    });
  }
}
