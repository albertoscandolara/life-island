import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  output,
} from '@angular/core';
import {
  priceUnitOf,
  UTILITIES,
  type BillDto,
  type UtilityKind,
} from '@life-island/contracts';
import {
  UiBadge,
  UiButton,
  UiCard,
  UiColumnChart,
  UiIcon,
  UiLineChart,
  type UiChartSeries,
} from '@life-island/design-system';
import { EntityLink } from '@life-island/entities-ui';
import { DOCUMENTS_APP_URL } from '@life-island/settings-ui';
import { HomeApi } from '../api/home-api';
import {
  bucketLabel,
  formatDate,
  formatEuro,
  formatEuroRound,
  formatNumber,
  formatPrice,
  formatTick,
  UTILITY_ICONS,
  utilityLabel,
} from '../shared/format';
import type { UtilityStats } from './aggregate';
import { percent, STEP_BADGES, type UtilityStep } from './next-steps';
import { UTILITY_GUIDES } from './utility-guides';

/** The offer a supply point of this utility is on now. */
export interface UtilityOffer {
  key: string;
  supplier: string | null;
  supplierId: string | null;
  offer: string | null;
  since: string | null;
  house: string | null;
}

/** Everything one utility's card shows, worked out by the page for its filters. */
export interface UtilityView {
  utility: UtilityKind;
  step: UtilityStep;
  stat: UtilityStats | null;
  months: number;
  /** Its price, bucket by bucket, and against a year ago. */
  price: {
    buckets: string[];
    categories: string[];
    series: UiChartSeries[];
    last: number | null;
    change: number | null;
    empty: boolean;
  };
  /** What it used, bucket by bucket (metered utilities). */
  use: { buckets: string[]; series: UiChartSeries[]; empty: boolean } | null;
  /** Internet: the fee and the extras on top. */
  fee: {
    buckets: string[];
    series: UiChartSeries[];
    extras: number;
  } | null;
  offers: UtilityOffer[];
  /** Its latest bills in the range, newest first. */
  latest: BillDto[];
  /** All its bills in the range. */
  count: number;
}

/**
 * One utility, read like a car document: the next step with its button,
 * what it costs and uses now and who supplies it, its price and use over
 * time, an "About it" box with the rules, then its latest bills.
 */
@Component({
  selector: 'home-bill-utility-card',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    UiCard,
    UiBadge,
    UiButton,
    UiIcon,
    UiLineChart,
    UiColumnChart,
    EntityLink,
  ],
  templateUrl: './bill-utility-card.html',
  styleUrls: ['./bill-utility-card.css'],
  host: { '[id]': '"bills-" + view().utility.toLowerCase()' },
})
export class BillUtilityCard {
  private readonly api = inject(HomeApi);
  protected readonly documentsUrl = inject(DOCUMENTS_APP_URL);

  readonly view = input.required<UtilityView>();
  /** Show this utility's bills in the list below. */
  readonly showBills = output<UtilityKind>();

  protected readonly info = computed(() => UTILITIES[this.view().utility]);
  protected readonly guide = computed(
    () => UTILITY_GUIDES[this.view().utility],
  );
  protected readonly badge = computed(
    () => STEP_BADGES[this.view().step.level],
  );
  protected readonly unit = computed(() => priceUnitOf(this.view().utility));
  protected readonly icon = computed(() => UTILITY_ICONS[this.view().utility]);
  protected readonly urgent = computed(() =>
    ['late', 'due', 'missing'].includes(this.view().step.level),
  );
  protected readonly perMonth = computed(() => {
    const v = this.view();
    return v.stat ? v.stat.amount / Math.max(1, v.months) : null;
  });

  protected readonly formatEuro = formatEuro;
  protected readonly formatEuroRound = formatEuroRound;
  protected readonly formatNumber = formatNumber;
  protected readonly formatDate = formatDate;
  protected readonly utilityLabel = utilityLabel;
  protected readonly percent = percent;
  protected readonly label = (key: string) => bucketLabel(key);
  protected readonly short = (key: string) => bucketLabel(key, true);
  protected readonly previewUrl = (id: string) => this.api.previewUrl(id);

  protected price(value: number | null): string {
    return formatPrice(value, this.view().utility);
  }

  /** Axis ticks: the price without its unit (the unit is in the heading). */
  protected readonly priceTick = computed(() => {
    const kind = this.view().utility;
    return (value: number) =>
      formatPrice(value, kind).replace(/\s?€\/.*$/, ' €');
  });
  protected readonly priceTitle = computed(() => {
    const buckets = this.view().price.buckets;
    return (i: number) => bucketLabel(buckets[i] ?? '');
  });
  protected readonly useTick = computed(() => {
    const unit = this.info().unit;
    return (value: number) => `${formatNumber(value)} ${unit}`;
  });
  protected readonly euroTick = computed(() => {
    const fee = this.view().fee;
    const max = Math.max(
      1,
      ...(fee?.series ?? []).flatMap((s) => s.values.map((v) => v ?? 0)),
    );
    return (value: number) => formatTick(value, max);
  });

  protected period(bill: BillDto): string {
    if (bill.periodStart && bill.periodEnd)
      return `${formatDate(bill.periodStart)} – ${formatDate(bill.periodEnd)}`;
    const day = bill.issueDate ?? bill.dueDate;
    return day ? formatDate(day) : 'No date';
  }

  /** "since Jun 2020". */
  protected since(day: string): string {
    return `since ${bucketLabel(day.slice(0, 7))}`;
  }
}
