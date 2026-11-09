import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
} from '@angular/core';
import type { CareerStatsDto } from '@life-island/contracts';
import { UiAlert, UiCard, UiEmptyState } from '@life-island/design-system';
import { ColumnChart, type ChartSeries } from '../charts/column-chart';
import {
  duration,
  euro,
  euroShort,
  hours,
  pct,
  periodText,
  shortPeriod,
} from './labels';

/** Payslips: your pay in numbers, month by month and year by year. */
@Component({
  selector: 'work-payslips',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ColumnChart, UiAlert, UiCard, UiEmptyState],
  templateUrl: './payslips-tab.html',
  styleUrls: ['./blocks.css'],
})
export class PayslipsTab {
  readonly stats = input.required<CareerStatsDto>();

  protected readonly euro = euro;
  protected readonly euroShort = euroShort;
  protected readonly duration = duration;
  protected readonly periodText = periodText;
  protected readonly shortPeriod = shortPeriod;
  protected readonly pct = pct;
  protected readonly hours = hours;

  /** The last 24 months of pay: gross and net, side by side. */
  protected readonly payChart = computed(() => {
    const monthly = this.stats().monthly.slice(-24);
    const series: ChartSeries[] = [
      {
        id: 'gross',
        label: 'Gross',
        color: 'var(--viz-gross)',
        values: monthly.map((m) => m.gross),
      },
      {
        id: 'net',
        label: 'Net pay',
        color: 'var(--viz-net)',
        values: monthly.map((m) => m.net),
      },
    ];
    return { buckets: monthly.map((m) => m.period), series };
  });
}
