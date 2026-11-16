import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  signal,
} from '@angular/core';
import type { Tax730TaxReturnDto } from '@life-island/contracts';
import { UiBadge, UiCard } from '@life-island/design-system';
import { formatEuro } from '../dashboard/format';
import {
  bracketRows,
  figuresOf,
  pct,
  taxSteps,
  taxWaterfall,
  type FigureSource,
} from './explain';

/**
 * How the tax of a year was computed, one step at a time, in plain words:
 * from income to taxable income, the brackets, the credits, and what was
 * already paid, down to the result. With a filed return and a forecast you
 * can switch between the two.
 */
@Component({
  selector: 'tax-steps-card',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [UiCard, UiBadge],
  template: `
    <ui-card heading="How your tax is calculated">
      @if (both()) {
        <div class="switch" uiCardActions role="group" aria-label="Figures">
          <button
            type="button"
            [attr.aria-pressed]="shown()?.source === 'filed'"
            (click)="prefer.set('filed')"
          >
            Filed
          </button>
          <button
            type="button"
            [attr.aria-pressed]="shown()?.source === 'forecast'"
            (click)="prefer.set('forecast')"
          >
            Forecast
          </button>
        </div>
      }
      @if (shown(); as s) {
        <p class="lead">
          @if (s.source === 'filed') {
            <ui-badge tone="success">From your filed return</ui-badge>
          } @else {
            <ui-badge tone="info">Forecast from your documents</ui-badge>
          }
          Read it top to bottom: each step starts from the one before.
        </p>

        <ol class="steps" role="list">
          @for (step of steps(); track step.id) {
            <li class="step step--{{ step.kind }}">
              <span class="step__sign" aria-hidden="true">{{
                step.kind === 'minus' ? '−' : step.kind === 'start' ? '' : '='
              }}</span>
              <div class="step__body">
                <div class="step__head">
                  <span class="step__label">{{ step.label }}</span>
                  <span
                    class="step__value num"
                    [class.credit]="step.kind === 'result' && step.value < 0"
                    [class.debit]="step.kind === 'result' && step.value > 0"
                    >{{ formatEuro(abs(step.value)) }}</span
                  >
                </div>
                <span class="step__it"
                  >{{ step.italian }} ·
                  <span class="num">{{ step.row }}</span></span
                >
                <p class="step__explain">{{ step.explain }}</p>
                @if (step.id === 'gross' && brackets().length) {
                  <ul class="brackets" role="list" aria-label="Tax brackets">
                    @for (b of brackets(); track b.from) {
                      <li class="bracket" [class.bracket--top]="b.top">
                        <span class="bracket__range"
                          >{{ formatEuro(b.from) }} –
                          {{
                            b.to === null ? 'and up' : formatEuro(b.to)
                          }}</span
                        >
                        <span class="bracket__track">
                          <span
                            class="bracket__fill"
                            [style.width.%]="
                              bracketFill(b.amount, b.to, b.from)
                            "
                          ></span>
                        </span>
                        <span class="bracket__rate num">{{ pct(b.rate) }}</span>
                        <span class="bracket__tax num">{{
                          b.amount ? formatEuro(b.tax) : '–'
                        }}</span>
                      </li>
                    }
                  </ul>
                  <p class="hint">
                    Your top bracket is
                    <strong>{{ pct(topRate()) }}</strong
                    >: one euro more of income costs {{ pct(topRate()) }} in
                    IRPEF, and one euro of deduction saves the same.
                  </p>
                }
              </div>
            </li>
          }
        </ol>

        @if (bars().length > 2) {
          <h3 class="sub">From gross tax to the result</h3>
          <ul class="legend" role="list">
            <li><span class="key key--total"></span>Tax</li>
            <li><span class="key key--minus"></span>Taken off</li>
            @if (hasLost()) {
              <li><span class="key key--hatched"></span>Credit lost</li>
            }
            <li><span class="key key--result"></span>Result</li>
          </ul>
          <ol class="fall" role="list">
            @for (bar of bars(); track bar.id) {
              <li class="fall__row">
                <span class="fall__label">{{ bar.label }}</span>
                <span class="fall__track">
                  <span class="fall__zero" [style.left.%]="pos(0)"></span>
                  <span
                    class="fall__bar bar--{{ bar.kind }}"
                    [class.bar--credit]="bar.kind === 'result' && bar.value < 0"
                    [style.left.%]="pos(bar.start)"
                    [style.width.%]="span(bar.start, bar.end)"
                  ></span>
                </span>
                <span class="fall__value num"
                  >{{ bar.kind === 'minus' || bar.kind === 'lost' ? '−' : ''
                  }}{{ formatEuro(abs(bar.value)) }}</span
                >
              </li>
            }
          </ol>
        }
        <p class="foot">
          IRPEF only: the regional and municipal surtaxes are computed apart on
          the same taxable income.
        </p>
      } @else {
        <p class="muted">
          Upload the return, or the Certificazione Unica of the year, to see how
          its tax is calculated.
        </p>
      }
    </ui-card>
  `,
  styleUrls: ['./explain.css', './steps-card.css'],
})
export class StepsCard {
  readonly taxReturn = input.required<Tax730TaxReturnDto>();
  readonly taxYear = input.required<number>();

  protected readonly prefer = signal<FigureSource>('filed');
  protected readonly both = computed(
    () => !!this.taxReturn().filed && !!this.taxReturn().forecast,
  );
  protected readonly shown = computed(() =>
    figuresOf(this.taxReturn(), this.prefer()),
  );
  protected readonly steps = computed(() => {
    const s = this.shown();
    return s ? taxSteps(s.figures, this.taxYear()) : [];
  });
  protected readonly brackets = computed(() => {
    const taxable = this.shown()?.figures.taxableIncome;
    return taxable ? bracketRows(taxable, this.taxYear()) : [];
  });
  protected readonly topRate = computed(
    () => this.brackets().find((b) => b.top)?.rate ?? 0,
  );
  protected readonly bars = computed(() => {
    const s = this.shown();
    return s ? taxWaterfall(s.figures) : [];
  });
  protected readonly hasLost = computed(() =>
    this.bars().some((b) => b.kind === 'lost'),
  );
  private readonly range = computed(() => {
    const values = this.bars().flatMap((b) => [b.start, b.end]);
    const lo = Math.min(0, ...values);
    const hi = Math.max(1, ...values);
    return { lo, hi };
  });

  protected readonly formatEuro = formatEuro;
  protected readonly pct = pct;
  protected readonly abs = Math.abs;

  protected pos(value: number): number {
    const { lo, hi } = this.range();
    return ((value - lo) / (hi - lo)) * 100;
  }
  protected span(start: number, end: number): number {
    const { lo, hi } = this.range();
    return Math.max(0.5, ((end - start) / (hi - lo)) * 100);
  }
  /** How full a bracket is; the open-ended one is drawn against the one below. */
  protected bracketFill(
    amount: number,
    to: number | null,
    from: number,
  ): number {
    const width = to === null ? Math.max(amount, from * 0.5, 1) : to - from;
    return Math.min(100, (amount / width) * 100);
  }
}
