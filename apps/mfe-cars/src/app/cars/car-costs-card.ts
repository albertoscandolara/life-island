import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
} from '@angular/core';
import {
  COST_KIND_LABELS,
  type CarCostDto,
  type CarCostTotalDto,
  type CarUsageDto,
  type CostKind,
} from '@life-island/contracts';
import {
  UiBadge,
  UiCard,
  UiColumnChart,
  type UiChartSeries,
} from '@life-island/design-system';
import { dateText, euro } from '@life-island/records-ui';
import { italianNumber } from './labels';

/** What one car cost, year by year and kind by kind, and the documents behind it. */
@Component({
  selector: 'cars-costs-card',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [UiBadge, UiCard, UiColumnChart],
  templateUrl: './car-costs-card.html',
  styleUrl: './car-costs-card.css',
})
export class CarCostsCard {
  readonly costs = input.required<CarCostDto[]>();
  readonly totals = input.required<CarCostTotalDto[]>();
  /** For the cost per km. */
  readonly usage = input<CarUsageDto | null>(null);

  protected readonly costKindLabels = COST_KIND_LABELS;
  protected readonly num = italianNumber;
  protected readonly euro = euro;
  protected readonly dateText = dateText;

  /** The years as columns, oldest first, stacked by what the money went on. */
  protected readonly chart = computed(() => {
    const totals = this.totals();
    const years = [...new Set(totals.map((t) => t.year))].sort((a, b) => a - b);
    if (!years.length) return null;
    const series: UiChartSeries[] = COST_GROUPS.map((g) => ({
      id: g.id,
      label: g.label,
      color: g.color,
      values: years.map((year) => {
        const sum = totals
          .filter((t) => t.year === year && groupOf(t.kind) === g.id)
          .reduce((s, t) => s + t.total, 0);
        return sum ? Math.round(sum * 100) / 100 : null;
      }),
    })).filter((s) => s.values.some((v) => v !== null));
    return { buckets: years.map(String), series };
  });

  protected readonly euroWhole = (v: number) => euro(v, false);

  /** Years with costs, newest first, and the kinds that appear in them. */
  protected readonly table = computed(() => {
    const totals = this.totals();
    const years = [...new Set(totals.map((t) => t.year))];
    const kinds = [...new Set(totals.map((t) => t.kind))];
    return {
      kinds,
      years: years.map((year) => {
        const of = (kind: CostKind) =>
          totals.find((t) => t.year === year && t.kind === kind)?.total ?? null;
        return {
          year,
          totals: kinds.map(of),
          total: totals
            .filter((t) => t.year === year)
            .reduce((sum, t) => sum + t.total, 0),
        };
      }),
    };
  });
}

/** The kinds of cost in a few groups, so a year's column reads at a glance. */
const COST_GROUPS = [
  { id: 'fuel', label: 'Fuel and charging', color: 'var(--viz-1)' },
  { id: 'insurance', label: 'Insurance', color: 'var(--viz-2)' },
  { id: 'road_tax', label: 'Road tax', color: 'var(--viz-3)' },
  {
    id: 'upkeep',
    label: 'Service, repairs, tyres',
    color: 'var(--viz-4)',
  },
  { id: 'other', label: 'Tolls, parking, other', color: 'var(--viz-other)' },
] as const;

function groupOf(kind: CostKind): (typeof COST_GROUPS)[number]['id'] {
  switch (kind) {
    case 'fuel':
    case 'ev_charging':
      return 'fuel';
    case 'insurance':
    case 'road_tax':
      return kind;
    case 'scheduled_service':
    case 'repair':
    case 'tyres':
    case 'body_work':
    case 'inspection':
    case 'cng_cylinders':
      return 'upkeep';
    default:
      return 'other';
  }
}
