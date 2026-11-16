import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  signal,
} from '@angular/core';
import type { Tax730TaxReturnDto } from '@life-island/contracts';
import { UiCard, UiInput } from '@life-island/design-system';
import { formatEuro } from '../dashboard/format';
import {
  figuresOf,
  pct,
  WHAT_IF_KINDS,
  WHAT_IF_LABELS,
  whatIf,
  type WhatIfKind,
} from './explain';

/**
 * "What would it be worth?": type an amount and a kind of expense or
 * contribution, and see what it would save against this year's tax, with
 * the part that would not fit (incapienza) and why. Runs in the browser.
 */
@Component({
  selector: 'tax-what-if-card',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [UiCard, UiInput],
  template: `
    <ui-card heading="What would it be worth?">
      @if (figures(); as f) {
        <p class="lead">
          Try an expense or a contribution against your
          {{ taxYear() }} figures: what it would really save, given the tax you
          have left to cut.
        </p>
        <div class="form">
          <label class="field">
            <span>Kind</span>
            <select
              class="ui-input"
              (change)="kind.set($any($event.target).value)"
            >
              @for (k of kinds; track k) {
                <option [value]="k" [selected]="kind() === k">
                  {{ labels[k] }}
                </option>
              }
            </select>
          </label>
          <label class="field">
            <span>Amount (€)</span>
            <input
              uiInput
              type="number"
              min="0"
              step="50"
              inputmode="decimal"
              [value]="amount()"
              (input)="amount.set(+$any($event.target).value || 0)"
            />
          </label>
        </div>

        @if (result(); as w) {
          <div class="out">
            <div class="out__main">
              <span class="out__label"
                >Saved in the {{ taxYear() }} return</span
              >
              <span class="out__value num">{{ formatEuro(w.thisYear) }}</span>
              @if (w.instalments > 1) {
                <span class="out__note"
                  >{{ formatEuro(w.total) }} over {{ w.instalments }} years if
                  your tax stays the same</span
                >
              }
            </div>
            <div class="out__bar" role="img" [attr.aria-label]="barLabel()">
              <span class="out__saved" [style.flex-grow]="w.total"></span>
              <span
                class="out__lost bar--lost"
                [style.flex-grow]="w.lost"
              ></span>
              <span class="out__rest" [style.flex-grow]="rest()"></span>
            </div>
            <ul class="legend" role="list">
              <li>
                <span class="key out__saved"></span>Saved
                {{ formatEuro(w.total) }}
              </li>
              @if (w.lost > 0) {
                <li>
                  <span class="key key--hatched"></span>Lost
                  {{ formatEuro(w.lost) }}
                </li>
              }
              <li><span class="key out__rest"></span>Still your cost</li>
            </ul>
            <p class="why">
              <strong>{{
                w.mechanism === 'deduzione'
                  ? 'A deduction (deduzione)'
                  : 'A tax credit (detrazione)'
              }}</strong>
              · {{ w.explain }}
              @if (w.mechanism === 'detrazione') {
                On paper {{ pct(w.rate) }} is {{ formatEuro(w.nominal) }}.
              }
            </p>
          </div>
        }
        <p class="foot">
          A rough guide with this year's figures ({{
            f.source === 'filed' ? 'filed return' : 'forecast'
          }}): caps, the €129.11 health franchigia and the limits above €75,000
          of income are not applied here.
        </p>
      } @else {
        <p class="muted">
          Needs the net tax of the year: upload the return or the Certificazione
          Unica.
        </p>
      }
    </ui-card>
  `,
  styleUrls: ['./explain.css', './what-if-card.css'],
})
export class WhatIfCard {
  readonly taxReturn = input.required<Tax730TaxReturnDto>();
  readonly taxYear = input.required<number>();

  protected readonly kinds = WHAT_IF_KINDS;
  protected readonly labels = WHAT_IF_LABELS;
  protected readonly kind = signal<WhatIfKind>('health');
  protected readonly amount = signal(1000);

  protected readonly figures = computed(() => {
    const s = figuresOf(this.taxReturn());
    return s && s.figures.netTax !== null ? s : null;
  });
  protected readonly result = computed(() => {
    const f = this.figures();
    return f
      ? whatIf(this.kind(), this.amount(), f.figures, this.taxYear())
      : null;
  });
  protected readonly rest = computed(() => {
    const w = this.result();
    return w ? Math.max(0, this.amount() - w.total - w.lost) : 0;
  });

  protected readonly formatEuro = formatEuro;
  protected readonly pct = pct;

  protected barLabel(): string {
    const w = this.result();
    if (!w) return '';
    return `Of ${formatEuro(this.amount())}: ${formatEuro(w.total)} saved, ${formatEuro(w.lost)} lost`;
  }
}
