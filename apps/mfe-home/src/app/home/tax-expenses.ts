import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import {
  HOUSE_TAX_EXPENSE_LABELS,
  type HouseTaxExpenseDto,
  type PropertyDto,
  type UpdateHouseTaxExpenseRequest,
  type WorkDto,
} from '@life-island/contracts';
import { NgTemplateOutlet } from '@angular/common';
import { UiBadge, UiButton, UiCard, UiIcon } from '@life-island/design-system';
import { EntityLink } from '@life-island/entities-ui';
import { errorMessage, HomeApi } from '../api/home-api';
import {
  formatDate,
  formatEuro,
  formatEuroRound,
  propertyColor,
} from '../shared/format';

/**
 * The home expenses you claim in the 730 (renovations, ecobonus, bonus
 * mobili), under the house they are for. Each one can become a work of the
 * house, or join one you already track, which then files its invoice and
 * payment. An expense no house is matched to waits for you to pick one.
 */
@Component({
  selector: 'home-tax-expenses',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [UiCard, UiBadge, UiButton, UiIcon, EntityLink, NgTemplateOutlet],
  template: `
    @if (visible().length || loose().length) {
      <ui-card heading="From your 730">
        <span uiCardActions class="muted total">
          {{ formatEuroRound(total()) }} claimed
        </span>
        <p class="muted intro">
          Home expenses of your 730 (renovations, ecobonus, furniture). Make one
          a work of its house, or add it to a work you already track.
        </p>
        @if (error(); as message) {
          <p class="error" role="alert">{{ message }}</p>
        }
        <ul class="list">
          @for (e of visible(); track e.expenseId) {
            <ng-container
              [ngTemplateOutlet]="row"
              [ngTemplateOutletContext]="{ $implicit: e }"
            />
          }
        </ul>
        @if (loose().length) {
          <h4 class="sub">With no house yet</h4>
          <ul class="list">
            @for (e of loose(); track e.expenseId) {
              <ng-container
                [ngTemplateOutlet]="row"
                [ngTemplateOutletContext]="{ $implicit: e }"
              />
            }
          </ul>
        }
      </ui-card>
    } @else if (unavailable()) {
      <p class="muted">
        The 730 area cannot be reached right now: its home expenses show here
        when it is back.
      </p>
    }

    <ng-template #row let-e>
      <li
        class="item"
        [class.item--busy]="busy() === e.expenseId"
        [style.--home-color]="color(e.propertyId)"
      >
        <div class="item__head">
          <div>
            <strong>{{ e.description ?? label(e) }}</strong>
            <div class="muted meta">
              {{ formatDate(e.date) }} ·
              <li-entity-link kind="organization" [name]="e.issuer" /> ·
              {{ label(e) }} · 730 of {{ e.taxYear + 1 }}
              @if (e.traceablePayment === false) {
                <ui-badge tone="warning">Not paid by transfer</ui-badge>
              }
            </div>
          </div>
          <strong class="amount">{{ formatEuro(e.amount) }}</strong>
        </div>
        <div class="item__docs">
          @for (d of e.documents; track d.uploadId) {
            <a
              class="doc"
              [href]="api.previewUrl(d.uploadId)"
              target="_blank"
              rel="noopener"
            >
              <ui-icon name="file" [size]="14" />
              {{ d.title ?? (d.role === 'PAYMENT' ? 'Payment' : 'Invoice') }}
            </a>
          }
        </div>
        <div class="item__actions">
          <select
            class="ui-input compact"
            [attr.aria-label]="'House of ' + (e.description ?? e.issuer)"
            [disabled]="busy() !== null"
            (change)="setHouse(e, $any($event.target).value)"
          >
            <option value="" [selected]="!e.propertyId">No house</option>
            @for (h of houses(); track h.id) {
              <option [value]="h.id" [selected]="h.id === e.propertyId">
                {{ h.name }}
              </option>
            }
            @if (e.match === 'MANUAL') {
              <option value="auto">Match it again</option>
            }
          </select>
          @if (e.propertyId) {
            @if (workOf(e); as w) {
              <span class="muted"
                ><ui-icon name="check" [size]="14" /> Part of “{{
                  w.title
                }}”</span
              >
              <button
                uiButton
                variant="ghost"
                size="sm"
                type="button"
                [disabled]="busy() !== null"
                (click)="link(e, null)"
              >
                Not part of it
              </button>
            } @else {
              @if (worksOf(e).length) {
                <select
                  class="ui-input compact"
                  aria-label="Add to a work"
                  [disabled]="busy() !== null"
                  (change)="link(e, $any($event.target).value || null)"
                >
                  <option value="" selected>Add to a work…</option>
                  @for (w of worksOf(e); track w.id) {
                    <option [value]="w.id">{{ w.title }}</option>
                  }
                </select>
              }
              <button
                uiButton
                size="sm"
                type="button"
                [loading]="busy() === e.expenseId"
                [disabled]="busy() !== null"
                (click)="makeWork(e)"
              >
                <ui-icon name="plus" [size]="14" /> Make it a work
              </button>
            }
          }
        </div>
      </li>
    </ng-template>
  `,
  styles: `
    :host {
      display: block;
    }
    .intro {
      margin: 0 0 var(--space-3);
    }
    .total {
      font-size: var(--text-sm);
    }
    .sub {
      margin: var(--space-4) 0 var(--space-2);
      color: var(--text-muted);
      font-size: var(--text-xs);
      font-weight: 600;
    }
    .list {
      display: grid;
      gap: var(--space-2);
      margin: 0;
      padding: 0;
      list-style: none;
    }
    .item {
      display: grid;
      gap: var(--space-2);
      padding: var(--space-3);
      border: 1px solid var(--border-subtle);
      border-left: 3px solid var(--home-color, var(--border-strong));
      border-radius: var(--radius-md);
    }
    .item--busy {
      opacity: 0.6;
    }
    .item__head {
      display: flex;
      justify-content: space-between;
      gap: var(--space-3);
    }
    .meta {
      font-size: var(--text-sm);
    }
    .amount {
      white-space: nowrap;
    }
    .item__docs,
    .item__actions {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: var(--space-2);
      font-size: var(--text-sm);
    }
    .item__actions select {
      width: auto;
      max-width: 100%;
    }
    .doc {
      display: inline-flex;
      align-items: center;
      gap: var(--space-1);
    }
    .error {
      margin: 0 0 var(--space-3);
      color: var(--danger);
    }
  `,
})
export class TaxExpenses {
  protected readonly api = inject(HomeApi);

  /** The houses in view (all of them when none is picked). */
  readonly scope = input<PropertyDto[]>([]);
  readonly houses = input<PropertyDto[]>([]);
  readonly works = input<WorkDto[]>([]);
  /** A work made or changed from an expense. */
  readonly workChanged = output<WorkDto>();

  protected readonly expenses = signal<HouseTaxExpenseDto[]>([]);
  protected readonly unavailable = signal(false);
  protected readonly busy = signal<string | null>(null);
  protected readonly error = signal<string | null>(null);

  protected readonly formatDate = formatDate;
  protected readonly formatEuro = formatEuro;
  protected readonly formatEuroRound = formatEuroRound;

  protected readonly visible = computed(() => {
    const ids = new Set(this.scope().map((h) => h.id));
    return this.expenses().filter((e) => e.propertyId && ids.has(e.propertyId));
  });
  protected readonly loose = computed(() =>
    this.expenses().filter((e) => !e.propertyId),
  );
  protected readonly total = computed(() =>
    this.visible().reduce((sum, e) => sum + e.amount, 0),
  );

  constructor() {
    this.load();
  }

  protected label(e: HouseTaxExpenseDto): string {
    return HOUSE_TAX_EXPENSE_LABELS[e.expenseType];
  }

  protected color(propertyId: string | null): string | null {
    const house = this.houses().find((h) => h.id === propertyId);
    return house ? propertyColor(house.colorSlot) : null;
  }

  protected workOf(e: HouseTaxExpenseDto): WorkDto | null {
    return this.works().find((w) => w.id === e.workId) ?? null;
  }

  protected worksOf(e: HouseTaxExpenseDto): WorkDto[] {
    return this.works().filter((w) => w.propertyId === e.propertyId);
  }

  protected setHouse(e: HouseTaxExpenseDto, target: string): void {
    this.save(
      e,
      target === 'auto'
        ? { automaticProperty: true }
        : { propertyId: target || null, workId: null },
    );
  }

  protected link(e: HouseTaxExpenseDto, workId: string | null): void {
    this.save(e, { workId }, () => {
      // The work filed the expense's invoice and payment: show them on it.
      const id = workId ?? e.workId;
      if (id)
        this.api.works().subscribe((works) => {
          const work = works.find((w) => w.id === id);
          if (work) this.workChanged.emit(work);
        });
    });
  }

  protected makeWork(e: HouseTaxExpenseDto): void {
    this.busy.set(e.expenseId);
    this.error.set(null);
    this.api.workFromTaxExpense(e.expenseId).subscribe({
      next: (work) => {
        this.busy.set(null);
        this.workChanged.emit(work);
        this.load();
      },
      error: (error) => this.fail(error),
    });
  }

  private save(
    e: HouseTaxExpenseDto,
    request: UpdateHouseTaxExpenseRequest,
    after?: () => void,
  ): void {
    this.busy.set(e.expenseId);
    this.error.set(null);
    this.api.updateTaxExpense(e.expenseId, request).subscribe({
      next: (saved) => {
        this.busy.set(null);
        this.expenses.update((list) =>
          list.map((x) => (x.expenseId === saved.expenseId ? saved : x)),
        );
        after?.();
      },
      error: (error) => this.fail(error),
    });
  }

  private load(): void {
    this.api.taxExpenses().subscribe({
      next: ({ available, expenses }) => {
        this.unavailable.set(!available);
        this.expenses.set(expenses);
      },
      error: () => {
        this.unavailable.set(true);
        this.expenses.set([]);
      },
    });
  }

  private fail(error: unknown): void {
    this.busy.set(null);
    this.error.set(errorMessage(error));
  }
}
