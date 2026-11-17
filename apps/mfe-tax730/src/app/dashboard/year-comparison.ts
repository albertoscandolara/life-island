import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  output,
} from '@angular/core';
import type { TaxYearDto } from '@life-island/contracts';
import {
  UiCard,
  UiColumnChart,
  type UiChartSeries,
} from '@life-island/design-system';
import { euro } from '@life-island/records-ui';
import { typeLabel } from './format';

/** The categorical palette: a seventh type and beyond go to "Other". */
const PALETTE = [1, 2, 3, 4, 5, 6].map((n) => `var(--viz-${n})`);

/** Years side by side: the deductible total of each, split by type, and its table. */
@Component({
  selector: 'tax-year-comparison',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [UiCard, UiColumnChart],
  template: `
    <ui-card heading="Deductible expenses, year by year">
      <ui-column-chart
        [buckets]="buckets()"
        [series]="series()"
        mode="stacked"
        [height]="240"
        [format]="wholeEuro"
        ariaLabel="Deductible expenses of each year, by type"
      />
      <div class="li-table-wrap">
        <table class="li-table li-table--nowrap">
          <caption class="ui-visually-hidden">
            Deductible expenses by type and year
          </caption>
          <thead>
            <tr>
              <th scope="col">Type</th>
              @for (y of ordered(); track y.taxYear) {
                <th scope="col" class="li-num">
                  <button
                    type="button"
                    class="li-link"
                    [attr.aria-label]="'Open ' + y.taxYear"
                    (click)="pick.emit(y.taxYear)"
                  >
                    {{ y.taxYear }}
                  </button>
                </th>
              }
            </tr>
          </thead>
          <tbody>
            @for (row of rows(); track row.type) {
              <tr>
                <th scope="row">{{ typeLabel(row.type) }}</th>
                @for (cell of row.cells; track $index) {
                  <td class="li-num">{{ euro(cell) }}</td>
                }
              </tr>
            }
            <tr class="total">
              <th scope="row">Total</th>
              @for (y of ordered(); track y.taxYear) {
                <td class="li-num">{{ euro(y.total) }}</td>
              }
            </tr>
          </tbody>
        </table>
      </div>
    </ui-card>
  `,
  styles: `
    .total th,
    .total td {
      font-weight: 600;
    }
  `,
})
export class YearComparison {
  readonly years = input.required<TaxYearDto[]>();
  /** A year was picked: the page opens it. */
  readonly pick = output<number>();

  protected readonly euro = euro;
  protected readonly typeLabel = typeLabel;
  protected readonly wholeEuro = (value: number) => euro(value, false);

  /** Oldest first, so the eye reads left to right through time. */
  protected readonly ordered = computed(() =>
    [...this.years()].sort((a, b) => a.taxYear - b.taxYear),
  );
  protected readonly buckets = computed(() =>
    this.ordered().map((y) => String(y.taxYear)),
  );

  /** Each type with its total in every year, the largest types first. */
  protected readonly rows = computed(() => {
    const years = this.ordered();
    const types = [
      ...new Set(years.flatMap((y) => y.byType.map((t) => t.expenseType))),
    ];
    const rows = types.map((type) => ({
      type,
      cells: years.map(
        (y) => y.byType.find((t) => t.expenseType === type)?.total ?? null,
      ),
    }));
    const sum = (cells: (number | null)[]) =>
      cells.reduce<number>((total, cell) => total + (cell ?? 0), 0);
    return rows.sort((a, b) => sum(b.cells) - sum(a.cells));
  });

  /** Six types keep their palette slot; the rest add up to "Other". */
  protected readonly series = computed<UiChartSeries[]>(() => {
    const rows = this.rows();
    const named = rows.slice(0, PALETTE.length).map((row, i) => ({
      id: row.type,
      label: typeLabel(row.type),
      color: PALETTE[i],
      values: row.cells,
    }));
    const rest = rows.slice(PALETTE.length);
    if (!rest.length) return named;
    return [
      ...named,
      {
        id: 'other',
        label: 'Other',
        color: 'var(--viz-other)',
        values: this.ordered().map((_, i) =>
          rest.reduce((total, row) => total + (row.cells[i] ?? 0), 0),
        ),
      },
    ];
  });
}
