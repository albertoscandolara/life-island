import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
} from '@angular/core';
import type { CareerStatsDto, TaxCertificateDto } from '@life-island/contracts';
import { UiAlert, UiCard, UiEmptyState } from '@life-island/design-system';
import { WorkApi } from '../api/work-api';
import { UiColumnChart, type UiChartSeries } from '@life-island/design-system';
import {
  duration,
  euro,
  euroShort,
  hours,
  pct,
  periodText,
  shortPeriod,
} from './labels';

/**
 * Payslips: your pay in numbers, month by month and year by year, and each
 * Certificazione Unica next to the payslips of its year.
 */
@Component({
  selector: 'work-payslips',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [UiColumnChart, UiAlert, UiCard, UiEmptyState],
  templateUrl: './payslips-tab.html',
  styleUrls: ['./blocks.css'],
})
export class PayslipsTab {
  readonly stats = input.required<CareerStatsDto>();
  readonly certificates = input<TaxCertificateDto[]>([]);

  private readonly api = inject(WorkApi);

  protected readonly euro = euro;
  protected readonly euroShort = euroShort;
  protected readonly duration = duration;
  protected readonly periodText = periodText;
  protected readonly shortPeriod = shortPeriod;
  protected readonly pct = pct;
  protected readonly hours = hours;

  /** Whether any year's payslips pay into a pension fund. */
  protected readonly hasPensionFund = computed(() =>
    this.stats().years.some((y) => y.pensionFund > 0),
  );
  /** Whether any CU prints the pension fund points (412, 413). */
  protected readonly cuPensionFund = computed(() =>
    this.certificates().some(
      (c) =>
        c.pensionFundDeducted !== null || c.pensionFundNotDeducted !== null,
    ),
  );

  protected previewUrl(uploadId: string): string {
    return this.api.previewUrl(uploadId);
  }

  /** Within a euro of the CU: the payslips add up. */
  protected matches(gap: number | null): boolean {
    return gap !== null && Math.abs(gap) < 1;
  }

  protected gap(gap: number | null): string {
    if (gap === null) return '–';
    if (this.matches(gap)) return 'Matches';
    return `${gap > 0 ? '+' : '−'}${euro(Math.abs(gap))}`;
  }

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
