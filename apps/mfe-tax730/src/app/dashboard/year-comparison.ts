import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  output,
} from '@angular/core';
import type { TaxYearDto } from '@life-island/contracts';
import { UiCard } from '@life-island/design-system';
import { formatEuro, typeLabel } from './format';

/** Years side by side: the deductible total of each, and each type across years. */
@Component({
  selector: 'tax-year-comparison',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [UiCard],
  template: `
    <ui-card heading="Compare years">
      <ul class="totals" role="list">
        @for (y of ordered(); track y.taxYear) {
          <li>
            <button
              type="button"
              class="total"
              [title]="
                y.taxYear +
                ': ' +
                formatEuro(y.total) +
                ', ' +
                y.expenseCount +
                ' expenses'
              "
              (click)="pick.emit(y.taxYear)"
            >
              <span class="total__year">{{ y.taxYear }}</span>
              <span class="total__track">
                <span
                  class="total__fill"
                  [style.width.%]="(y.total / max()) * 100"
                ></span>
              </span>
              <span class="total__value">{{ formatEuro(y.total) }}</span>
            </button>
          </li>
        }
      </ul>
      <div class="table-wrap">
        <table class="table">
          <caption class="visually-hidden">
            Deductible expenses by type and year
          </caption>
          <thead>
            <tr>
              <th scope="col">Type</th>
              @for (y of ordered(); track y.taxYear) {
                <th scope="col" class="num">{{ y.taxYear }}</th>
              }
            </tr>
          </thead>
          <tbody>
            @for (row of rows(); track row.type) {
              <tr>
                <th scope="row">{{ typeLabel(row.type) }}</th>
                @for (cell of row.cells; track $index) {
                  <td class="num">
                    {{ cell === null ? '–' : formatEuro(cell) }}
                  </td>
                }
              </tr>
            }
          </tbody>
        </table>
      </div>
    </ui-card>
  `,
  styles: `
    .totals {
      display: grid;
      gap: var(--space-2);
      margin: 0 0 var(--space-6);
      padding: 0;
      list-style: none;
    }
    .total {
      display: grid;
      grid-template-columns: 4rem 1fr 8rem;
      align-items: center;
      gap: var(--space-3);
      width: 100%;
      padding: var(--space-1) 0;
      border: 0;
      background: none;
      color: var(--text-secondary);
      font: inherit;
      text-align: left;
      cursor: pointer;
    }
    .total:hover .total__fill {
      opacity: 0.85;
    }
    .total__year {
      color: var(--text-primary);
      font-weight: 600;
    }
    .total__track {
      height: var(--space-3);
      border-radius: var(--radius-full);
      background: var(--surface-sunken);
    }
    .total__fill {
      display: block;
      height: 100%;
      min-width: var(--space-1);
      border-radius: var(--radius-full);
      background: var(--accent);
    }
    .total__value {
      font-variant-numeric: tabular-nums;
      text-align: right;
    }
    .table-wrap {
      overflow-x: auto;
    }
    .table {
      width: 100%;
      border-collapse: collapse;
      color: var(--text-secondary);
      font-size: var(--text-sm);
    }
    .table th,
    .table td {
      padding: var(--space-2) var(--space-3);
      border-bottom: 1px solid var(--border-subtle);
      text-align: left;
    }
    .table thead th {
      color: var(--text-muted);
      font-weight: 500;
    }
    .table tbody th {
      color: var(--text-primary);
      font-weight: 500;
    }
    .num {
      font-variant-numeric: tabular-nums;
      text-align: right !important;
    }
    .visually-hidden {
      position: absolute;
      width: 1px;
      height: 1px;
      overflow: hidden;
      clip-path: inset(50%);
    }
  `,
})
export class YearComparison {
  readonly years = input.required<TaxYearDto[]>();
  readonly pick = output<number>();

  protected readonly formatEuro = formatEuro;
  protected readonly typeLabel = typeLabel;

  /** Oldest first, so the eye reads left to right through time. */
  protected readonly ordered = computed(() =>
    [...this.years()].sort((a, b) => a.taxYear - b.taxYear),
  );
  protected readonly max = computed(() =>
    Math.max(1, ...this.years().map((y) => y.total)),
  );
  protected readonly rows = computed(() => {
    const years = this.ordered();
    const types = [
      ...new Set(years.flatMap((y) => y.byType.map((t) => t.expenseType))),
    ];
    return types.map((type) => ({
      type,
      cells: years.map(
        (y) => y.byType.find((t) => t.expenseType === type)?.total ?? null,
      ),
    }));
  });
}
