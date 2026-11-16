import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
} from '@angular/core';
import type { Tax730TaxReturnDto } from '@life-island/contracts';
import { UiCard } from '@life-island/design-system';
import { formatEuro } from '../dashboard/format';
import { creditsUse, euroSplit, figuresOf, marginalRate, pct } from './explain';

/**
 * Where each €100 of income goes, your effective rate against your top
 * rate, and what your tax credits were worth: which kinds, how much of
 * them fitted in your tax, and how much was lost.
 */
@Component({
  selector: 'tax-euro-card',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [UiCard],
  template: `
    <ui-card heading="Where each €100 of income goes">
      @if (split(); as s) {
        <div
          class="hundred"
          role="img"
          [attr.aria-label]="
            'Of each 100 euros: ' +
            s.irpef +
            ' IRPEF, ' +
            s.credits +
            ' saved by credits, ' +
            s.kept +
            ' kept'
          "
        >
          <span
            class="hundred__part hundred__part--irpef"
            [style.flex-grow]="s.irpef"
          ></span>
          <span
            class="hundred__part hundred__part--credits"
            [style.flex-grow]="s.credits"
          ></span>
          <span
            class="hundred__part hundred__part--kept"
            [style.flex-grow]="s.kept"
          ></span>
        </div>
        <ul class="parts" role="list">
          <li>
            <span class="key part--irpef"></span>
            <strong class="num">€{{ s.irpef.toFixed(0) }}</strong>
            <span>IRPEF you pay</span>
          </li>
          <li>
            <span class="key part--credits"></span>
            <strong class="num">€{{ s.credits.toFixed(0) }}</strong>
            <span>tax your credits cancelled</span>
          </li>
          <li>
            <span class="key part--kept"></span>
            <strong class="num">€{{ s.kept.toFixed(0) }}</strong>
            <span>stays with you (before INPS and surtaxes)</span>
          </li>
        </ul>

        <div class="rates">
          <div class="rate">
            <span class="rate__label">Effective rate</span>
            <span class="rate__value num">{{ pct(s.effectiveRate) }}</span>
            <span class="rate__note">IRPEF you pay ÷ your income</span>
          </div>
          <div class="rate">
            <span class="rate__label">Before credits</span>
            <span class="rate__value num">{{ pct(s.grossRate) }}</span>
            <span class="rate__note">Gross IRPEF ÷ your income</span>
          </div>
          @if (top() !== null) {
            <div class="rate">
              <span class="rate__label">Top bracket</span>
              <span class="rate__value num">{{ pct(top()!) }}</span>
              <span class="rate__note">What your next euro pays</span>
            </div>
          }
        </div>
        <p class="muted">
          The top bracket applies only to the income above its limit, so the tax
          you pay on average is always lower.
        </p>
      } @else {
        <p class="muted">
          Needs the income and the gross tax of the year: upload the return or
          the Certificazione Unica.
        </p>
      }

      @if (credits(); as c) {
        <h3 class="sub">Your tax credits</h3>
        @if (c.total > 0) {
          <p class="lead">
            Credits worth <strong>{{ formatEuro(c.total) }}</strong> against a
            gross tax of {{ formatEuro(gross()) }}:
            @if (c.lost > 0) {
              <strong class="debit"
                >{{ formatEuro(c.lost) }} did not fit</strong
              >
              and was lost. Credits can bring the tax to zero, never below, and
              what is left is not paid to you.
            } @else {
              all of them fitted in your tax.
            }
          </p>
          <div class="capienza" role="img" [attr.aria-label]="capienzaLabel()">
            <div
              class="capienza__tax"
              [style.width.%]="(gross() / scaleMax()) * 100"
            >
              <span>Gross tax {{ formatEuro(gross()) }}</span>
            </div>
            <div class="capienza__credits">
              @for (part of parts(); track part.label) {
                <span
                  class="capienza__part"
                  [style.width.%]="(part.value / scaleMax()) * 100"
                  [style.background]="part.color"
                  [title]="part.label + ': ' + formatEuro(part.value)"
                ></span>
              }
            </div>
            @if (c.lost > 0) {
              <span
                class="capienza__line"
                [style.left.%]="(gross() / scaleMax()) * 100"
              ></span>
            }
          </div>
          <ul class="legend" role="list">
            @for (part of parts(); track part.label) {
              <li>
                <span class="key" [style.background]="part.color"></span>
                {{ part.label }}
                <span class="num">{{ formatEuro(part.value) }}</span>
              </li>
            }
          </ul>
          @if (c.lost > 0 && hasRenovation()) {
            <p class="tip">
              Building-bonus instalments are the first casualty of a low tax: a
              lost instalment is gone for good. Before new works, check with the
              commercialista that the yearly instalment fits your tax, or
              whether a co-owner with more tax should pay (and claim) part of
              them.
            </p>
          }
        } @else {
          <p class="muted">No tax credits in this year's figures.</p>
        }
      }
    </ui-card>
  `,
  styleUrls: ['./explain.css', './euro-card.css'],
})
export class EuroCard {
  readonly taxReturn = input.required<Tax730TaxReturnDto>();
  readonly taxYear = input.required<number>();

  private readonly shown = computed(() => figuresOf(this.taxReturn()));
  protected readonly split = computed(() => {
    const s = this.shown();
    return s ? euroSplit(s.figures) : null;
  });
  protected readonly top = computed(() => {
    const taxable = this.shown()?.figures.taxableIncome;
    return taxable ? marginalRate(taxable, this.taxYear()) : null;
  });
  protected readonly credits = computed(() => {
    const s = this.shown();
    return s ? creditsUse(s.figures) : null;
  });
  protected readonly gross = computed(
    () => this.shown()?.figures.grossTax ?? 0,
  );
  protected readonly scaleMax = computed(() =>
    Math.max(1, this.gross(), this.credits()?.total ?? 0),
  );
  /** The credits by kind; the expense credits not split by section go in one. */
  protected readonly parts = computed(() => {
    const s = this.shown();
    if (!s) return [];
    const f = s.figures;
    const b = s.buckets;
    const known =
      (b.general ?? 0) +
      (b.renovation ?? 0) +
      (b.otherHome ?? 0) +
      (b.energy ?? 0);
    const rest = Math.max(0, (f.expenseDeductions ?? 0) - known);
    return [
      {
        label: 'Employment',
        value: f.workDeductions ?? 0,
        color: 'var(--viz-part-1)',
      },
      {
        label: '19% expenses',
        value: b.general ?? 0,
        color: 'var(--viz-part-3)',
      },
      {
        label: 'Building bonus',
        value: b.renovation ?? 0,
        color: 'var(--viz-part-2)',
      },
      {
        label: 'Furniture and other home',
        value: b.otherHome ?? 0,
        color: 'var(--viz-part-4)',
      },
      {
        label: 'Energy efficiency',
        value: b.energy ?? 0,
        color: 'var(--viz-gross)',
      },
      {
        label: 'Other credits',
        value: rest > 1 ? rest : 0,
        color: 'var(--viz-other)',
      },
    ].filter((p) => p.value > 0);
  });
  protected readonly hasRenovation = computed(() =>
    this.parts().some((p) => p.label === 'Building bonus'),
  );

  protected readonly formatEuro = formatEuro;
  protected readonly pct = pct;

  protected capienzaLabel(): string {
    const c = this.credits();
    return `Gross tax ${formatEuro(this.gross())}, credits ${formatEuro(c?.total ?? 0)}${
      c?.lost ? `, ${formatEuro(c.lost)} lost` : ''
    }`;
  }
}
