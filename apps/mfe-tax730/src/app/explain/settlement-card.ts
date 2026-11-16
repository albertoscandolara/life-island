import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
} from '@angular/core';
import type { Tax730TaxReturnDto } from '@life-island/contracts';
import { UiBadge, UiCard } from '@life-island/design-system';
import { formatDate, formatEuro } from '../dashboard/format';
import { settlementOf } from './explain';

/**
 * What the result of the return means and what to do with it: a credit or
 * a debit, how an F24 uses a credit to pay the balance and next year's
 * advances, and what is left to carry over or claim back.
 */
@Component({
  selector: 'tax-settlement-card',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [UiCard, UiBadge],
  template: `
    @let r = taxReturn();
    <ui-card heading="Credit or debit: what happens next">
      @if (settlement(); as s) {
        <div class="result">
          <span class="result__label">{{
            s.result < 0 ? 'Your credit' : s.result > 0 ? 'To pay' : 'Result'
          }}</span>
          <span
            class="result__value num"
            [class.credit]="s.result < 0"
            [class.debit]="s.result > 0"
            >{{ formatEuro(abs(s.result)) }}</span
          >
          <span class="muted"
            >{{ r.formLabel }} {{ r.filingYear }}: IRPEF and the regional and
            municipal surtaxes together</span
          >
        </div>

        @if (s.form === '730') {
          <p class="lead">
            With a 730 your employer settles it:
            @if (s.result < 0) {
              the credit is added to your <strong>July payslip</strong>
              (August or September for pensioners).
            } @else if (s.result > 0) {
              the amount is taken from your <strong>July payslip</strong>, in
              instalments up to November if you asked for them.
            } @else {
              there is nothing to pay or to get back.
            }
          </p>
        } @else {
          <p class="lead">
            With Redditi PF nobody settles it for you.
            @if (s.credit > 0) {
              A credit is money the State owes you: you can use it to pay other
              taxes in an <strong>F24</strong> (offsetting, compensazione),
              leave it for next year's return, or ask for a refund (rimborso,
              which takes months).
            }
            @if (s.due > 0) {
              What is due is paid with an F24 by 30 June (30 July with 0.4%
              more).
            }
          </p>

          @if (s.steps.length) {
            <h3 class="sub">The F24s of {{ r.filingYear }}</h3>
            <ol class="timeline" role="list">
              @for (step of s.steps; track $index) {
                <li class="tl" [class.tl--credit]="step.paidWith === 'credit'">
                  <span class="tl__date">{{ formatDate(step.date) }}</span>
                  <span class="tl__dot" aria-hidden="true"></span>
                  <span class="tl__body">
                    <span class="tl__label">{{ step.label }}</span>
                    <span class="tl__how">
                      @if (step.paidWith === 'credit') {
                        <ui-badge tone="success"
                          >Paid with your credit</ui-badge
                        >
                      } @else {
                        <ui-badge tone="warning">You pay</ui-badge>
                      }
                    </span>
                  </span>
                  <span class="tl__amount num">{{
                    formatEuro(step.amount)
                  }}</span>
                </li>
              }
            </ol>
          }

          <dl class="sums">
            @if (s.credit > 0) {
              <div>
                <dt>Credit</dt>
                <dd class="num credit">{{ formatEuro(s.credit) }}</dd>
              </div>
            }
            @if (s.due > 0) {
              <div>
                <dt>Balance due</dt>
                <dd class="num">{{ formatEuro(s.due) }}</dd>
              </div>
            }
            @if (s.nextAdvances > 0) {
              <div>
                <dt>Advances for {{ r.filingYear }}</dt>
                <dd class="num">{{ formatEuro(s.nextAdvances) }}</dd>
              </div>
            }
            <div>
              <dt>You still pay</dt>
              <dd class="num" [class.debit]="s.toPay > 0">
                {{ formatEuro(s.toPay) }}
              </dd>
            </div>
            @if (s.credit > 0) {
              <div>
                <dt>Credit left</dt>
                <dd class="num credit">{{ formatEuro(s.creditLeft) }}</dd>
              </div>
            }
          </dl>
          @if (s.creditLeft > 0) {
            <p class="muted">
              The {{ formatEuro(s.creditLeft) }} left can pay other taxes in an
              F24 (IMU, for example) or go into next year's return, where it
              lowers what you pay or grows your credit. An F24 that is paid
              entirely with a credit totals zero but must still be sent, online.
            </p>
          }
          <p class="foot">
            The advances are an estimate from this return (RN62); if next year's
            income is lower you may pay less, at your own risk.
          </p>
        }
      } @else if (r.forecast?.figures?.balance; as balance) {
        <div class="result">
          <span class="result__label">Expected</span>
          <span
            class="result__value num"
            [class.credit]="balance < 0"
            [class.debit]="balance > 0"
            >{{ balance < 0 ? 'Credit ' : 'To pay '
            }}{{ formatEuro(abs(balance)) }}</span
          >
          <span class="muted">IRPEF only, from your documents</span>
        </div>
        <p class="lead">
          @if (r.form === '730') {
            With a 730 your employer settles it in the July payslip.
          } @else {
            With Redditi PF
            @if (balance < 0) {
              a credit is yours to use in an F24 against other taxes and next
              year's advances, or to claim back.
            } @else {
              what is due is paid with an F24 by 30 June.
            }
          }
          Upload the {{ r.formLabel }} once filed to see the real result.
        </p>
      } @else {
        <p class="muted">
          Once the return is filed (or forecast from your documents), its result
          and what to do with it show here.
        </p>
      }
    </ui-card>
  `,
  styleUrls: ['./explain.css', './settlement-card.css'],
})
export class SettlementCard {
  readonly taxReturn = input.required<Tax730TaxReturnDto>();

  protected readonly settlement = computed(() =>
    settlementOf(this.taxReturn()),
  );
  protected readonly formatEuro = formatEuro;
  protected readonly formatDate = formatDate;
  protected readonly abs = Math.abs;
}
