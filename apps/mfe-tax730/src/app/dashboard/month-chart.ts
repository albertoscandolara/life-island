import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
} from '@angular/core';
import {
  UiCard,
  UiColumnChart,
  type UiChartSeries,
} from '@life-island/design-system';
import { euro } from '@life-island/records-ui';

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

/** What you spent in each month of the tax year, as columns, with its table. */
@Component({
  selector: 'tax-month-chart',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [UiCard, UiColumnChart],
  template: `
    <ui-card [heading]="'Spending by month, ' + taxYear()">
      <ui-column-chart
        [buckets]="months"
        [series]="series()"
        [height]="220"
        [format]="wholeEuro"
        [label]="monthLabel()"
        [ariaLabel]="'Deductible spending in each month of ' + taxYear()"
      />
      <table class="ui-visually-hidden">
        <caption>
          Deductible spending by month,
          {{
            taxYear()
          }}
        </caption>
        <tbody>
          @for (month of months; track month; let i = $index) {
            <tr>
              <th scope="row">{{ month }}</th>
              <td>{{ euro(values()[i] ?? 0) }}</td>
            </tr>
          }
        </tbody>
      </table>
    </ui-card>
  `,
})
export class MonthChart {
  readonly taxYear = input.required<number>();
  /** Twelve totals, January first. */
  readonly values = input.required<number[]>();

  protected readonly months = MONTHS;
  protected readonly euro = euro;
  protected readonly wholeEuro = (value: number) => euro(value, false);

  protected readonly series = computed<UiChartSeries[]>(() => [
    {
      id: 'spending',
      label: 'Deductible spending',
      color: 'var(--viz-deductible)',
      values: MONTHS.map((_, i) => this.values()[i] ?? 0),
    },
  ]);

  protected readonly monthLabel = computed(() => {
    const year = this.taxYear();
    return (month: string) => `${month} ${year}`;
  });
}
