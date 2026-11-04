import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  signal,
} from '@angular/core';
import {
  UTILITIES,
  UTILITY_KINDS,
  type BillDto,
  type UtilityKind,
} from '@life-island/contracts';
import {
  UiAlert,
  UiBadge,
  UiButton,
  UiCard,
  UiEmptyState,
  UiIcon,
  UiPageHeader,
} from '@life-island/design-system';
import { errorMessage, HomeApi } from '../api/home-api';
import { ColumnChart, type ChartSeries } from '../charts/column-chart';
import { LineChart } from '../charts/line-chart';
import { SegmentedBar, type BarPart } from '../charts/segmented-bar';
import { Sparkline } from '../charts/sparkline';
import { HousesView } from '../houses/houses-view';
import { AreaNav } from '../shared/area-nav';
import {
  bucketLabel,
  formatDate,
  formatEuro,
  formatEuroRound,
  formatNumber,
  formatTick,
  propertyColor,
  UTILITY_ICONS,
  utilityColor,
  utilityLabel,
} from '../shared/format';
import { PropertiesDialog } from '../shared/properties-dialog';
import { PropertyStore } from '../shared/property-store';
import {
  addMonths,
  aggregate,
  extent,
  groupRows,
  monthsBetween,
  previousRange,
  totalIn,
  utilityStats,
  yearOverYear,
  type Basis,
  type Grain,
  type GroupBy,
  type MonthRange,
} from './aggregate';

export type RangePreset =
  '6m' | '12m' | '24m' | '5y' | 'ytd' | 'all' | 'custom';

const PRESETS: { id: RangePreset; label: string }[] = [
  { id: '6m', label: '6 months' },
  { id: '12m', label: '12 months' },
  { id: '24m', label: '2 years' },
  { id: '5y', label: '5 years' },
  { id: 'ytd', label: 'This year' },
  { id: 'all', label: 'All' },
];

const MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];
const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

/** The latest years for the year-over-year lines, newest darkest (one hue, light to dark). */
const YEAR_SHADES = [100, 72, 48, 30];

/**
 * Stego's Bills: electricity, gas and water of every home, on one dashboard.
 * Filters scope everything below them: which home, which utilities, the
 * period, how it is bucketed, and whether a bill counts over the months it
 * covers or in the month it was issued.
 */
@Component({
  selector: 'home-bills-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    UiPageHeader,
    UiCard,
    UiButton,
    UiBadge,
    UiIcon,
    UiAlert,
    UiEmptyState,
    AreaNav,
    ColumnChart,
    LineChart,
    SegmentedBar,
    Sparkline,
    PropertiesDialog,
    HousesView,
  ],
  host: { 'data-character': 'stego', class: 'bills' },
  templateUrl: './bills-page.html',
  styleUrls: ['../shared/kit.css', './bills-page.css'],
})
export class BillsPage {
  private readonly api = inject(HomeApi);
  protected readonly store = inject(PropertyStore);

  /** `?property=<id>` from the URL; absent for every home. */
  readonly property = input<string>();
  /** `?split=1`: every home side by side instead of together. */
  readonly split = input<string>();

  protected readonly bills = signal<BillDto[] | null>(null);
  protected readonly error = signal<string | null>(null);
  protected readonly managing = signal(false);

  protected readonly preset = signal<RangePreset>('12m');
  protected readonly customFrom = signal<string>(
    addMonths(currentMonth(), -11),
  );
  protected readonly customTo = signal<string>(currentMonth());
  protected readonly grainChoice = signal<Grain | 'auto'>('auto');
  protected readonly basis = signal<Basis>('period');
  protected readonly utilities = signal<UtilityKind[]>([...UTILITY_KINDS]);
  protected readonly stacked = signal(true);
  protected readonly tableFor = signal<Record<string, boolean>>({});
  protected readonly yoyUtility = signal<UtilityKind | 'ALL'>('ALL');
  protected readonly groupBy = signal<GroupBy>('period');
  protected readonly onlyUnassigned = signal(false);
  protected readonly showAllBills = signal(false);

  protected readonly presets = PRESETS;
  protected readonly kinds = UTILITY_KINDS;
  protected readonly info = UTILITIES;
  protected readonly icons = UTILITY_ICONS;
  protected readonly formatEuro = formatEuro;
  protected readonly formatEuroRound = formatEuroRound;
  protected readonly formatNumber = formatNumber;
  protected readonly formatDate = formatDate;
  protected readonly bucketLabel = bucketLabel;
  protected readonly utilityLabel = utilityLabel;
  protected readonly utilityColor = utilityColor;
  protected readonly propertyColor = propertyColor;
  protected readonly previewUrl = (id: string) => this.api.previewUrl(id);

  protected readonly selected = computed(() => {
    const id = this.property();
    return this.store.properties()?.find((p) => p.id === id) ?? null;
  });
  protected readonly isSplit = computed(
    () =>
      !this.selected() &&
      this.split() === '1' &&
      (this.store.properties()?.length ?? 0) > 1,
  );

  /** Bills of the chosen home (all homes, unassigned included) and utilities, any date. */
  protected readonly scoped = computed(() => {
    const property = this.selected();
    const utilities = this.utilities();
    return (this.bills() ?? []).filter(
      (bill) =>
        (!property || bill.propertyId === property.id) &&
        utilities.includes(bill.utility),
    );
  });

  protected readonly range = computed<MonthRange>(() => {
    const now = currentMonth();
    switch (this.preset()) {
      case '6m':
        return { from: addMonths(now, -5), to: now };
      case '12m':
        return { from: addMonths(now, -11), to: now };
      case '24m':
        return { from: addMonths(now, -23), to: now };
      case '5y':
        return { from: addMonths(now, -59), to: now };
      case 'ytd':
        return { from: `${now.slice(0, 4)}-01`, to: now };
      case 'all':
        return (
          extent(this.bills() ?? [], this.basis()) ?? {
            from: addMonths(now, -11),
            to: now,
          }
        );
      case 'custom': {
        const [from, to] = [this.customFrom(), this.customTo()].sort();
        return { from, to };
      }
    }
  });

  protected readonly months = computed(
    () => monthsBetween(this.range()).length,
  );

  protected readonly grain = computed<Grain>(() => {
    const choice = this.grainChoice();
    if (choice !== 'auto') return choice;
    const months = this.months();
    return months <= 24 ? 'month' : months <= 60 ? 'quarter' : 'year';
  });

  protected readonly rangeLabel = computed(() => {
    const { from, to } = this.range();
    return from === to
      ? bucketLabel(from)
      : `${bucketLabel(from)} – ${bucketLabel(to)}`;
  });

  // ---- Headline figures --------------------------------------------------

  protected readonly total = computed(() =>
    totalIn(this.scoped(), this.range(), this.basis()),
  );
  protected readonly previousTotal = computed(() =>
    totalIn(this.scoped(), previousRange(this.range()), this.basis()),
  );
  protected readonly delta = computed(() => {
    const previous = this.previousTotal();
    return previous > 0 ? (this.total() - previous) / previous : null;
  });
  protected readonly perMonth = computed(
    () => this.total() / Math.max(1, this.months()),
  );

  protected readonly stats = computed(() =>
    utilityStats(this.scoped(), this.range(), this.basis(), this.utilities()),
  );

  /** Monthly cost of each utility over the range, for the tiles' sparklines. */
  protected readonly trends = computed(() => {
    const result = aggregate(this.scoped(), {
      range: this.range(),
      grain: this.months() > 36 ? 'quarter' : 'month',
      basis: this.basis(),
      metric: 'amount',
      keys: UTILITY_KINDS,
      keyOf: (bill) => bill.utility,
    });
    return Object.fromEntries(
      result.series.map((s) => [s.id, s.values]),
    ) as Record<UtilityKind, number[]>;
  });

  protected readonly nextDue = computed(() => {
    const today = new Date().toISOString().slice(0, 10);
    return (
      this.scoped()
        .filter((bill) => bill.dueDate && bill.dueDate >= today)
        .sort((a, b) => a.dueDate!.localeCompare(b.dueDate!))[0] ?? null
    );
  });
  protected readonly latest = computed(() => this.scoped()[0] ?? null);

  protected readonly unassigned = computed(
    () =>
      (this.bills() ?? []).filter((bill) => bill.propertyId === null).length,
  );

  // ---- Charts ------------------------------------------------------------

  /** Cost over time, one series per utility (or per home when side by side). */
  protected readonly costChart = computed(() => {
    if (this.isSplit()) return this.byProperty('amount');
    const result = aggregate(this.scoped(), {
      range: this.range(),
      grain: this.grain(),
      basis: this.basis(),
      metric: 'amount',
      keys: this.utilities(),
      keyOf: (bill) => bill.utility,
    });
    return {
      buckets: result.buckets,
      series: result.series.map<ChartSeries>((s) => ({
        id: s.id,
        label: utilityLabel(s.id as UtilityKind),
        color: utilityColor(s.id as UtilityKind),
        values: s.values,
      })),
    };
  });

  /** One small chart per home, sharing a scale: utilities stacked in each. */
  protected readonly homeMultiples = computed(() => {
    if (!this.isSplit()) return [];
    const homes = this.store.properties() ?? [];
    const charts = homes.map((home) => {
      const result = aggregate(this.scoped(), {
        range: this.range(),
        grain: this.grain(),
        basis: this.basis(),
        metric: 'amount',
        keys: this.utilities(),
        keyOf: (bill) => (bill.propertyId === home.id ? bill.utility : null),
      });
      const total = totalIn(
        this.scoped().filter((b) => b.propertyId === home.id),
        this.range(),
        this.basis(),
      );
      return {
        home,
        total,
        buckets: result.buckets,
        series: result.series.map<ChartSeries>((s) => ({
          id: s.id,
          label: utilityLabel(s.id as UtilityKind),
          color: utilityColor(s.id as UtilityKind),
          values: s.values,
        })),
      };
    });
    const max = Math.max(
      0,
      ...charts.flatMap((c) =>
        c.buckets.map((_, i) =>
          c.series.reduce((sum, s) => sum + (s.values[i] ?? 0), 0),
        ),
      ),
    );
    return charts.map((c) => ({ ...c, max }));
  });

  /** January to December, one line per year: the last four years with bills. */
  protected readonly yoy = computed(() => {
    const utility = this.yoyUtility();
    const bills = this.scoped().filter(
      (b) => utility === 'ALL' || b.utility === utility,
    );
    const metric = utility === 'ALL' ? 'amount' : 'consumption';
    const years = [
      ...new Set(
        bills.flatMap((b) =>
          [b.periodStart, b.periodEnd, b.issueDate]
            .filter(Boolean)
            .map((d) => Number(d!.slice(0, 4))),
        ),
      ),
    ]
      .sort()
      .slice(-4);
    const lines = yearOverYear(bills, this.basis(), metric, years);
    return {
      metric,
      unit: utility === 'ALL' ? '€' : UTILITIES[utility].unit,
      series: lines.map<ChartSeries>((line, i) => ({
        id: String(line.year),
        label: String(line.year),
        color: `color-mix(in srgb, ${utility === 'ALL' ? 'var(--accent)' : utilityColor(utility)} ${YEAR_SHADES[lines.length - 1 - i]}%, var(--surface-card))`,
        values: line.values,
      })),
    };
  });

  /** Consumption per utility in its own unit: one chart each, never two units on one axis. */
  protected readonly consumption = computed(() =>
    this.utilities().map((utility) => {
      const result = aggregate(this.scoped(), {
        range: this.range(),
        grain: this.grain(),
        basis: this.basis(),
        metric: 'consumption',
        keys: [utility],
        keyOf: (bill) => bill.utility,
      });
      const stat = this.stats().find((s) => s.utility === utility);
      return {
        utility,
        unit: UTILITIES[utility].unit,
        stat,
        buckets: result.buckets,
        series: [
          {
            id: utility,
            label: `${utilityLabel(utility)} (${UTILITIES[utility].unit})`,
            color: utilityColor(utility),
            values: result.series[0].values,
          },
        ] satisfies ChartSeries[],
        empty: result.series[0].values.every((v) => !v),
      };
    }),
  );

  protected readonly utilityParts = computed<BarPart[]>(() =>
    this.stats().map((s) => ({
      id: s.utility,
      label: utilityLabel(s.utility),
      color: utilityColor(s.utility),
      value: s.amount,
    })),
  );

  protected readonly homeParts = computed<BarPart[]>(() => {
    if (this.selected()) return [];
    const parts = (this.store.properties() ?? []).map((p) => ({
      id: p.id,
      label: p.name,
      color: propertyColor(p.colorSlot),
      value: totalIn(
        this.scoped().filter((b) => b.propertyId === p.id),
        this.range(),
        this.basis(),
      ),
    }));
    const loose = totalIn(
      this.scoped().filter((b) => b.propertyId === null),
      this.range(),
      this.basis(),
    );
    return loose > 0
      ? [
          ...parts,
          {
            id: 'none',
            label: 'Unassigned',
            color: 'var(--viz-other)',
            value: loose,
          },
        ]
      : parts;
  });

  protected readonly providers = computed(() =>
    groupRows(this.scoped(), {
      range: this.range(),
      basis: this.basis(),
      grain: this.grain(),
      by: 'provider',
      labelOfProperty: (id) => this.store.name(id),
    }).slice(0, 5),
  );

  // ---- Tables ------------------------------------------------------------

  protected readonly groups = computed(() =>
    groupRows(this.scoped(), {
      range: this.range(),
      basis: this.basis(),
      grain: this.grain(),
      by: this.groupBy(),
      labelOfProperty: (id) => this.store.name(id),
    }),
  );

  protected readonly listed = computed(() => {
    const { from, to } = this.range();
    const inRange = (bill: BillDto) => {
      const start = (
        bill.periodStart ??
        bill.issueDate ??
        bill.dueDate ??
        ''
      ).slice(0, 7);
      const end = (
        bill.periodEnd ??
        bill.issueDate ??
        bill.dueDate ??
        ''
      ).slice(0, 7);
      return !start || (end >= from && start <= to);
    };
    const bills = this.onlyUnassigned()
      ? (this.bills() ?? []).filter((b) => b.propertyId === null)
      : this.scoped().filter(inRange);
    return this.showAllBills() ? bills : bills.slice(0, 12);
  });
  protected readonly listedTotal = computed(() =>
    this.onlyUnassigned() ? this.unassigned() : this.scoped().length,
  );

  protected readonly formatAxis = computed(() => {
    const max = Math.max(
      1,
      ...this.costChart().series.flatMap((s) => s.values.map((v) => v ?? 0)),
    );
    return (value: number) => formatTick(value, max);
  });
  protected readonly short = computed(
    () => (key: string) =>
      bucketLabel(key, this.grain() === 'month' && this.months() <= 12),
  );
  protected readonly label = (key: string) => bucketLabel(key);
  protected readonly unitFormat = (unit: string) => (value: number) =>
    `${formatNumber(value)} ${unit}`;
  protected readonly monthTitle = (i: number) => MONTH_NAMES[i];
  protected readonly monthNames = MONTHS;

  constructor() {
    this.load();
  }

  protected toggleUtility(kind: UtilityKind): void {
    this.utilities.update((list) => {
      const next = list.includes(kind)
        ? list.filter((k) => k !== kind)
        : [...list, kind];
      // Keep the fixed order, so colours and stacks never move; never none.
      return next.length ? UTILITY_KINDS.filter((k) => next.includes(k)) : list;
    });
  }

  protected toggleTable(id: string): void {
    this.tableFor.update((all) => ({ ...all, [id]: !all[id] }));
  }

  protected setCustom(which: 'from' | 'to', event: Event): void {
    const value = (event.target as HTMLInputElement).value;
    if (!/^\d{4}-\d{2}$/.test(value)) return;
    (which === 'from' ? this.customFrom : this.customTo).set(value);
    this.preset.set('custom');
  }

  protected value(event: Event): string {
    return (event.target as HTMLSelectElement).value;
  }

  protected assign(bill: BillDto, value: string): void {
    const request =
      value === 'auto'
        ? { automaticProperty: true as const }
        : { propertyId: value === 'none' ? null : value };
    this.correct(bill, request);
  }

  protected setUtility(bill: BillDto, value: string): void {
    this.correct(bill, { utility: value as UtilityKind });
  }

  protected exclude(bill: BillDto): void {
    this.correct(bill, { excluded: true });
  }

  protected period(bill: BillDto): string {
    if (bill.periodStart && bill.periodEnd)
      return `${formatDate(bill.periodStart)} – ${formatDate(bill.periodEnd)}`;
    const day = bill.issueDate ?? bill.dueDate;
    return day ? formatDate(day) : 'No date';
  }

  protected assignmentHint(bill: BillDto): string {
    switch (bill.assignment) {
      case 'MANUAL':
        return 'You chose it';
      case 'CATEGORY':
        return 'From its category';
      case 'SUPPLY_CODE':
        return 'From its supply code';
      case 'ADDRESS':
        return 'From its address';
      default:
        return 'Not matched to a home';
    }
  }

  protected groupLabel(key: string): string {
    if (this.groupBy() === 'period') return bucketLabel(key);
    if (this.groupBy() === 'utility') return utilityLabel(key as UtilityKind);
    return key;
  }

  private byProperty(metric: 'amount') {
    const homes = this.store.properties() ?? [];
    const result = aggregate(this.scoped(), {
      range: this.range(),
      grain: this.grain(),
      basis: this.basis(),
      metric,
      keys: homes.map((h) => h.id),
      keyOf: (bill) => bill.propertyId,
    });
    return {
      buckets: result.buckets,
      series: result.series.map<ChartSeries>((s, i) => ({
        id: s.id,
        label: homes[i].name,
        color: propertyColor(homes[i].colorSlot),
        values: s.values,
      })),
    };
  }

  private correct(
    bill: BillDto,
    request: Parameters<HomeApi['updateBill']>[1],
  ): void {
    this.api.updateBill(bill.uploadId, request).subscribe({
      next: ({ bill: updated }) =>
        this.bills.update((bills) =>
          (bills ?? [])
            .map((b) => (b.uploadId === bill.uploadId ? updated : b))
            .filter((b): b is BillDto => b !== null),
        ),
      error: (error) => this.error.set(errorMessage(error)),
    });
  }

  private load(): void {
    this.api.bills().subscribe({
      next: (bills) => {
        this.error.set(null);
        this.bills.set(bills);
      },
      error: (error) => {
        this.bills.set([]);
        this.error.set(errorMessage(error));
      },
    });
  }
}

function currentMonth(): string {
  return new Date().toISOString().slice(0, 7);
}
