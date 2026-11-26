import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
} from '@angular/core';
import type { CareerStatsDto } from '@life-island/contracts';
import { UiCard, UiEmptyState } from '@life-island/design-system';
import { UiColumnChart, type UiChartSeries } from '@life-island/design-system';
import { euro, euroShort, periodText, shortPeriod } from './labels';

/**
 * Pay: what your payslips paid month by month and year by year. The
 * payslips themselves, their checks and the CU are in the Payslips section.
 */
@Component({
  selector: 'work-payslips',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [UiColumnChart, UiCard, UiEmptyState],
  templateUrl: './payslips-tab.html',
  styleUrls: ['./blocks.css'],
})
export class PayslipsTab {
  readonly stats = input.required<CareerStatsDto>();

  protected readonly euro = euro;
  protected readonly euroShort = euroShort;
  protected readonly periodText = periodText;
  protected readonly shortPeriod = shortPeriod;

  /** Whether any year's payslips pay into a pension fund. */
  protected readonly hasPensionFund = computed(() =>
    this.stats().years.some((y) => y.pensionFund > 0),
  );
  /** The last 24 months of pay: gross and net, side by side. */
  protected readonly payChart = computed(() => {
    const monthly = this.stats().monthly.slice(-24);
    const series: UiChartSeries[] = [
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
