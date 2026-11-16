import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  output,
} from '@angular/core';
import type { TaxYearDto } from '@life-island/contracts';
import { UiCard } from '@life-island/design-system';
import { formatEuro } from '../dashboard/format';
import { pct, trendOf } from './explain';

/**
 * Your tax year after year: the gross tax split into what you paid and
 * what your credits cancelled (and lost), the effective rate, and the
 * result of each return. Filed years are solid, forecast ones striped.
 */
@Component({
  selector: 'tax-trend-card',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [UiCard],
  template: `
    <ui-card heading="Your tax over the years">
      @if (trend().length) {
        <ul class="legend" role="list">
          <li><span class="key k-net"></span>IRPEF paid</li>
          <li><span class="key k-credits"></span>Cancelled by credits</li>
          @if (anyLost()) {
            <li><span class="key key--hatched"></span>Credits lost</li>
          }
          @if (anyForecast()) {
            <li><span class="key k-forecast"></span>Forecast, not filed yet</li>
          }
        </ul>
        <ol class="cols" role="list" [style.--n]="trend().length">
          @for (y of trend(); track y.taxYear) {
            <li class="col" [class.col--on]="y.taxYear === selected()">
              <button
                type="button"
                class="col__hit"
                [class.col--forecast]="y.source === 'forecast'"
                [attr.aria-label]="describe(y)"
                (click)="pick.emit(y.taxYear)"
              >
                <span class="col__stack">
                  @if (y.lost) {
                    <span
                      class="seg bar--lost"
                      [style.height.%]="h(y.lost)"
                    ></span>
                  }
                  <span
                    class="seg seg--credits"
                    [style.height.%]="h(y.creditsUsed ?? 0)"
                  ></span>
                  <span
                    class="seg seg--net"
                    [style.height.%]="h(y.netTax ?? 0)"
                  ></span>
                </span>
                <span class="col__rate num">{{
                  y.effectiveRate === null ? '–' : pct(y.effectiveRate)
                }}</span>
                <span class="col__year">{{ y.taxYear }}</span>
              </button>
            </li>
          }
        </ol>
        <p class="muted">
          The percentage is the effective rate: IRPEF paid over income. Pick a
          year to open it.
        </p>

        <h3 class="sub">Result of each return</h3>
        <ol class="results" role="list">
          @for (y of trend(); track y.taxYear) {
            <li class="res">
              <span class="res__year"
                >{{ y.taxYear }}
                @if (y.source === 'forecast') {
                  <span class="res__fc">forecast</span>
                }
              </span>
              <span class="res__track">
                <span class="res__axis"></span>
                @if (y.result !== null && y.result !== 0) {
                  <span
                    class="res__bar"
                    [class.res__bar--credit]="y.result < 0"
                    [class.col--forecast]="y.source === 'forecast'"
                    [style.width.%]="(abs(y.result) / resultMax()) * 50"
                  ></span>
                }
              </span>
              <span
                class="res__value num"
                [class.credit]="(y.result ?? 0) < 0"
                [class.debit]="(y.result ?? 0) > 0"
                >{{
                  y.result === null
                    ? '–'
                    : (y.result < 0
                        ? 'credit '
                        : y.result > 0
                          ? 'to pay '
                          : '') + formatEuro(abs(y.result))
                }}</span
              >
            </li>
          }
        </ol>
        <p class="axis-note muted">
          <span>← credit, yours back</span><span>to pay →</span>
        </p>

        <div class="table-wrap">
          <table class="table">
            <caption class="visually-hidden">
              Tax figures by year
            </caption>
            <thead>
              <tr>
                <th scope="col">Year</th>
                <th scope="col" class="num">Income</th>
                <th scope="col" class="num">Gross IRPEF</th>
                <th scope="col" class="num">Credits used</th>
                <th scope="col" class="num">Lost</th>
                <th scope="col" class="num">Net IRPEF</th>
                <th scope="col" class="num">Rate</th>
                <th scope="col" class="num">Result</th>
              </tr>
            </thead>
            <tbody>
              @for (y of trend(); track y.taxYear) {
                <tr>
                  <th scope="row">
                    {{ y.taxYear }}
                    <span class="form"
                      >{{ y.formLabel
                      }}{{ y.source === 'forecast' ? ' · forecast' : '' }}</span
                    >
                  </th>
                  <td class="num">{{ money(y.income) }}</td>
                  <td class="num">{{ money(y.grossTax) }}</td>
                  <td class="num">{{ money(y.creditsUsed) }}</td>
                  <td class="num" [class.debit]="!!y.lost">
                    {{ y.lost ? formatEuro(y.lost) : '–' }}
                  </td>
                  <td class="num">{{ money(y.netTax) }}</td>
                  <td class="num">
                    {{ y.effectiveRate === null ? '–' : pct(y.effectiveRate) }}
                  </td>
                  <td
                    class="num"
                    [class.credit]="(y.result ?? 0) < 0"
                    [class.debit]="(y.result ?? 0) > 0"
                  >
                    {{ money(y.result) }}
                  </td>
                </tr>
              }
            </tbody>
          </table>
        </div>
        <p class="foot">
          IRPEF only. Years with flat-rate (forfettario) income pay a separate
          5% or 15% tax on it, in quadro LM, not shown here. A negative result
          is a credit.
        </p>
      } @else {
        <p class="muted">
          Upload your past returns (730 or Redditi PF) to see how your tax
          changed year after year.
        </p>
      }
    </ui-card>
  `,
  styleUrls: ['./explain.css', './trend-card.css'],
})
export class TrendCard {
  readonly years = input.required<TaxYearDto[]>();
  readonly selected = input<number | null>(null);
  readonly pick = output<number>();

  protected readonly trend = computed(() => trendOf(this.years()));
  protected readonly anyLost = computed(() =>
    this.trend().some((y) => !!y.lost),
  );
  protected readonly anyForecast = computed(() =>
    this.trend().some((y) => y.source === 'forecast'),
  );
  private readonly max = computed(() =>
    Math.max(
      1,
      ...this.trend().map(
        (y) => (y.netTax ?? 0) + (y.creditsUsed ?? 0) + (y.lost ?? 0),
      ),
    ),
  );
  protected readonly resultMax = computed(() =>
    Math.max(1, ...this.trend().map((y) => Math.abs(y.result ?? 0))),
  );

  protected readonly formatEuro = formatEuro;
  protected readonly pct = pct;
  protected readonly abs = Math.abs;

  protected h(value: number): number {
    return (value / this.max()) * 100;
  }
  protected money(value: number | null): string {
    return value === null ? '–' : formatEuro(value);
  }
  protected describe(y: ReturnType<typeof trendOf>[number]): string {
    return `${y.taxYear}${y.source === 'forecast' ? ' (forecast)' : ''}: IRPEF ${this.money(
      y.netTax,
    )}, credits ${this.money(y.creditsUsed)}${
      y.lost ? `, lost ${formatEuro(y.lost)}` : ''
    }, rate ${y.effectiveRate === null ? 'unknown' : pct(y.effectiveRate)}`;
  }
}
