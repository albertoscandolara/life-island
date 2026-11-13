import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  output,
} from '@angular/core';
import type {
  DossierExpenseDto,
  Tax730ExpenseKind,
} from '@life-island/contracts';
import { UiBadge, UiButton, UiIcon } from '@life-island/design-system';
import { formatDate, formatEuro } from './format';

const KIND_LABELS: Record<Tax730ExpenseKind, string> = {
  INVOICE: 'Invoice',
  PAYMENT: 'Payment',
};

/**
 * The expenses that are this same one (the transfers that paid an invoice,
 * the second receipt of a transfer), counted once: you confirm the pair, say
 * one is not the same, or pair it with another expense by hand.
 */
@Component({
  selector: 'tax-expense-pairs',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [UiBadge, UiButton, UiIcon],
  template: `
    @let e = expense();
    @if (e.paired.length) {
      <section class="pairs" aria-label="Paired with this expense">
        <h4 class="pairs__heading">
          Same expense, counted once
          @if (toReview()) {
            <button uiButton size="sm" type="button" (click)="confirm.emit()">
              <ui-icon name="check" [size]="16" /> Confirm pairing
            </button>
          }
        </h4>
        <ul class="pairs__list" role="list">
          @for (p of e.paired; track p.id) {
            <li class="pair">
              <span class="pair__date">{{ formatDate(p.date) }}</span>
              <span class="pair__main">
                <span class="pair__issuer">{{ p.issuer }}</span>
                <span class="pair__desc">{{ p.description || '–' }}</span>
              </span>
              <ui-badge [tone]="p.kind === 'PAYMENT' ? 'info' : 'neutral'">{{
                kindLabels[p.kind]
              }}</ui-badge>
              <ui-badge [tone]="p.automatic ? 'warning' : 'success'">{{
                p.automatic ? 'Automatic' : 'Confirmed'
              }}</ui-badge>
              <span class="pair__amount">{{ formatEuro(p.amount) }}</span>
              <button
                uiButton
                variant="ghost"
                size="sm"
                type="button"
                [attr.aria-label]="
                  'Not the same expense: ' +
                  p.issuer +
                  ', ' +
                  formatEuro(p.amount)
                "
                (click)="separate.emit(p.id)"
              >
                <ui-icon name="x" [size]="16" /> Not the same
              </button>
            </li>
          }
        </ul>
      </section>
    }
    @if (e.pairing === 'SEPARATE') {
      <p class="note">
        You kept this expense apart from its pair, so it is counted on its own.
        <button
          uiButton
          variant="ghost"
          size="sm"
          type="button"
          (click)="autoPair.emit()"
        >
          Pair it automatically again
        </button>
      </p>
    }
    @if (others().length) {
      <label class="pair-with">
        <span>Same expense as</span>
        <select
          #pick
          (change)="pick.value && pairWith.emit(pick.value); pick.value = ''"
        >
          <option value="">Choose one…</option>
          @for (o of others(); track o.id) {
            <option [value]="o.id">
              {{ formatDate(o.date) }} · {{ o.issuer }} ·
              {{ formatEuro(o.amount) }}
            </option>
          }
        </select>
      </label>
    }
  `,
  styles: `
    :host {
      display: grid;
      gap: var(--space-3);
    }

    .pairs,
    .pairs__list {
      display: grid;
      gap: var(--space-2);
      margin: 0;
      padding: 0;
      list-style: none;
    }

    .pairs__heading {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: space-between;
      gap: var(--space-2);
      margin: 0;
      color: var(--text-primary);
      font-size: var(--text-sm);
    }

    .pair {
      display: grid;
      grid-template-columns: 6rem minmax(0, 1fr) auto auto 7rem auto;
      align-items: center;
      gap: var(--space-2);
      padding: var(--space-2);
      border-radius: var(--radius-sm);
      background: var(--surface-sunken);
      color: var(--text-secondary);
      font-size: var(--text-sm);
    }

    .pair__main {
      display: grid;
      min-width: 0;
    }

    .pair__issuer {
      color: var(--text-primary);
    }

    .pair__desc {
      overflow: hidden;
      font-size: var(--text-xs);
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .pair__amount {
      font-variant-numeric: tabular-nums;
      text-align: right;
    }

    .note {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: var(--space-2);
      margin: 0;
      color: var(--text-secondary);
    }

    .pair-with {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: var(--space-2);
      color: var(--text-secondary);
      font-size: var(--text-sm);
    }

    .pair-with select {
      min-width: 0;
      max-width: 100%;
      padding: var(--space-1) var(--space-2);
      border: 1px solid var(--border-strong);
      border-radius: var(--radius-sm);
      background: var(--surface-card);
      color: var(--text-primary);
      font: inherit;
    }

    @media (width <= 48rem) {
      .pair {
        grid-template-columns: minmax(0, 1fr) auto;
      }

      .pair__date {
        display: none;
      }
    }
  `,
})
export class ExpensePairs {
  readonly expense = input.required<DossierExpenseDto>();
  /** The year's expenses, to pair this one with by hand. */
  readonly expenses = input.required<DossierExpenseDto[]>();

  readonly confirm = output<void>();
  /** The expense (by id) that is not the same: it is counted on its own. */
  readonly separate = output<string>();
  readonly autoPair = output<void>();
  /** The expense (by id) this one is the same as. */
  readonly pairWith = output<string>();

  protected readonly kindLabels = KIND_LABELS;
  protected readonly formatDate = formatDate;
  protected readonly formatEuro = formatEuro;

  protected readonly toReview = computed(() =>
    this.expense().paired.some((p) => p.automatic),
  );
  protected readonly others = computed(() =>
    this.expenses().filter((o) => o.id !== this.expense().id),
  );
}
