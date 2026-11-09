import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
} from '@angular/core';
import {
  IRPEF_SOURCE,
  type CareerInsightsDto,
  type CareerStatsDto,
} from '@life-island/contracts';
import { UiCard, UiEmptyState } from '@life-island/design-system';
import { ColumnChart, type ChartSeries } from '../charts/column-chart';
import { euro, euroShort, hours, pct, periodText, shortPeriod } from './labels';

/** The last 24 months of a monthly series. */
const LAST = 24;

/**
 * Pay analysis: your pay against inflation and the CCNL minimums, what it is
 * made of, what a year really paid you, where the gross goes (contributions,
 * IRPEF and its brackets), and the time off, overtime and travel on your
 * payslips.
 */
@Component({
  selector: 'work-pay-analysis',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ColumnChart, UiCard, UiEmptyState],
  templateUrl: './pay-analysis-tab.html',
  styleUrls: ['./blocks.css', './pay-analysis-tab.css'],
})
export class PayAnalysisTab {
  readonly insights = input.required<CareerInsightsDto>();
  readonly stats = input.required<CareerStatsDto>();

  protected readonly euro = euro;
  protected readonly euroShort = euroShort;
  protected readonly hours = hours;
  protected readonly pct = pct;
  protected readonly periodText = periodText;
  protected readonly shortPeriod = shortPeriod;
  protected readonly irpefSource = IRPEF_SOURCE;
  protected readonly yearLabel = (year: string) => year;

  protected readonly real = computed(() => this.insights().realPay);
  protected readonly ccnl = computed(() => this.insights().ccnl);
  protected readonly latestTaxYear = computed(
    () => this.insights().taxYears[0] ?? null,
  );

  /** Average salary each year, as paid and in euros of the latest year. */
  protected readonly realChart = computed(() => {
    const years = this.real().years;
    const series: ChartSeries[] = [
      {
        id: 'paid',
        label: 'As paid',
        color: 'var(--viz-gross)',
        values: years.map((y) => y.averageSalary),
      },
      {
        id: 'real',
        label: `In ${this.real().baseYear ?? ''} euros`,
        color: 'var(--viz-net)',
        values: years.map((y) => y.realSalary),
      },
    ];
    return { buckets: years.map((y) => String(y.year)), series };
  });

  protected readonly partsChart = computed(() => {
    const points = this.insights()
      .salaryParts.filter((p) => p.total !== null)
      .slice(-LAST);
    const series: ChartSeries[] = [
      {
        id: 'base',
        label: 'CCNL minimum',
        color: 'var(--viz-part-1)',
        values: points.map((p) => p.base),
      },
      {
        id: 'superminimum',
        label: 'Superminimum',
        color: 'var(--viz-part-2)',
        values: points.map((p) => p.superminimum),
      },
      {
        id: 'other',
        label: 'Increments and other items',
        color: 'var(--viz-part-3)',
        values: points.map((p) => p.other),
      },
    ];
    // Without the base the parts would not add up: show the total alone.
    const split = points.some((p) => p.base !== null);
    return {
      buckets: points.map((p) => p.period),
      series: split
        ? series.filter((s) => s.values.some((v) => v))
        : [
            {
              id: 'total',
              label: 'Monthly salary',
              color: 'var(--viz-gross)',
              values: points.map((p) => p.total),
            },
          ],
      split,
    };
  });

  protected readonly taxChart = computed(() => {
    const months = this.insights().taxMonths.slice(-LAST);
    const series: ChartSeries[] = [
      {
        id: 'net',
        label: 'Net pay',
        color: 'var(--viz-net)',
        values: months.map((m) => m.net),
      },
      {
        id: 'tax',
        label: 'IRPEF',
        color: 'var(--viz-part-4)',
        values: months.map((m) => m.incomeTax),
      },
      {
        id: 'contributions',
        label: 'Contributions',
        color: 'var(--viz-part-2)',
        values: months.map((m) => m.contributions),
      },
      {
        id: 'other',
        label: 'Surtaxes and other deductions',
        color: 'var(--viz-other)',
        values: months.map((m) =>
          m.other !== null && m.other > 0 ? m.other : null,
        ),
      },
    ];
    return {
      buckets: months.map((m) => m.period),
      series: series.filter((s) => s.values.some((v) => v)),
    };
  });

  protected readonly timeOffChart = computed(() => {
    const points = this.insights().timeOff.points.slice(-LAST);
    const series: ChartSeries[] = [
      {
        id: 'vacation',
        label: 'Vacation',
        color: 'var(--viz-part-1)',
        values: points.map((p) => p.vacation),
      },
      {
        id: 'leave',
        label: 'Leave (ROL, permessi)',
        color: 'var(--viz-part-3)',
        values: points.map((p) => p.leave),
      },
    ];
    return {
      buckets: points.map((p) => p.period),
      series: series.filter((s) => s.values.some((v) => v !== null)),
    };
  });

  /** Months with any overtime or travel, newest first. */
  protected readonly workload = computed(() =>
    [...this.insights().workload]
      .filter(
        (p) =>
          p.overtimeHours || p.overtimePay || p.travelDays || p.travelAllowance,
      )
      .reverse()
      .slice(0, 12),
  );
  protected readonly workloadTotals = computed(() => {
    const year = this.insights().workload.slice(-12);
    const add = (pick: (p: (typeof year)[number]) => number | null) =>
      year.reduce((s, p) => s + (pick(p) ?? 0), 0);
    return {
      overtimeHours: add((p) => p.overtimeHours),
      overtimePay: add((p) => p.overtimePay),
      travelDays: add((p) => p.travelDays),
      travelAllowance: add((p) => p.travelAllowance),
    };
  });
  /** Whether payslips read before these fields existed leave the view empty. */
  protected readonly workloadRead = computed(() =>
    this.insights().workload.some(
      (p) =>
        p.overtimeHours !== null ||
        p.overtimePay !== null ||
        p.travelDays !== null ||
        p.travelAllowance !== null,
    ),
  );

  protected readonly hoursFormat = (v: number) => `${v} h`;

  protected signedEuro(value: number | null): string {
    if (value === null) return '–';
    return `${value > 0 ? '+' : value < 0 ? '−' : ''}${euro(Math.abs(value))}`;
  }

  protected signedHours(value: number | null): string {
    if (value === null) return '–';
    return `${value > 0 ? '+' : value < 0 ? '−' : ''}${hours(Math.abs(value))}`;
  }

  protected rate(value: number | null): string {
    return value === null ? '–' : `${value.toLocaleString('it-IT')}%`;
  }
}
