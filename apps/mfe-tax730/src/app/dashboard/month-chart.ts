import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
} from '@angular/core';
import { UiCard } from '@life-island/design-system';
import { formatEuro } from './format';

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

/** What you spent in each month of the tax year, as columns. */
@Component({
  selector: 'tax-month-chart',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [UiCard],
  template: `
    <ui-card [heading]="'Spending by month, ' + taxYear()">
      <ol class="chart" role="list">
        @for (m of months(); track m.label) {
          <li
            class="month"
            [title]="m.label + ' ' + taxYear() + ': ' + formatEuro(m.value)"
          >
            <span class="month__value">{{
              m.value ? short(m.value) : ''
            }}</span>
            <span class="month__track">
              <span class="month__fill" [style.height.%]="m.height"></span>
            </span>
            <span class="month__label">{{ m.label }}</span>
          </li>
        }
      </ol>
    </ui-card>
  `,
  styles: `
    .chart {
      display: grid;
      grid-template-columns: repeat(12, minmax(0, 1fr));
      gap: var(--space-1);
      margin: 0;
      padding: 0;
      list-style: none;
    }
    .month {
      display: grid;
      grid-template-rows: 1.25rem 8rem auto;
      gap: var(--space-1);
      justify-items: center;
      color: var(--text-muted);
      font-size: var(--text-xs);
    }
    .month__value {
      color: var(--text-secondary);
      font-variant-numeric: tabular-nums;
      white-space: nowrap;
    }
    .month__track {
      display: flex;
      align-items: flex-end;
      width: 100%;
      max-width: 2rem;
      border-radius: var(--radius-sm);
      background: var(--surface-sunken);
    }
    .month__fill {
      display: block;
      width: 100%;
      border-radius: var(--radius-sm);
      background: var(--accent);
    }
  `,
})
export class MonthChart {
  readonly taxYear = input.required<number>();
  /** Twelve totals, January first. */
  readonly values = input.required<number[]>();

  protected readonly formatEuro = formatEuro;

  protected readonly months = computed(() => {
    const values = this.values();
    const max = Math.max(1, ...values);
    return MONTHS.map((label, i) => ({
      label,
      value: values[i] ?? 0,
      height: ((values[i] ?? 0) / max) * 100,
    }));
  });

  protected short(value: number): string {
    return value >= 1000
      ? `${(value / 1000).toFixed(value >= 10000 ? 0 : 1)}k`
      : String(Math.round(value));
  }
}
