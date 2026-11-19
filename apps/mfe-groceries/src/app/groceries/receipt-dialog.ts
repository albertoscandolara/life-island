import {
  ChangeDetectionStrategy,
  Component,
  effect,
  inject,
  input,
  model,
  output,
  signal,
  untracked,
} from '@angular/core';
import type { ReceiptDetailDto } from '@life-island/contracts';
import {
  UiAlert,
  UiBadge,
  UiButton,
  UiDialog,
  UiIcon,
} from '@life-island/design-system';
import { EntityLink } from '@life-island/entities-ui';
import { dateText, errorText, euro } from '@life-island/records-ui';
import type { Observable } from 'rxjs';
import { GroceriesApi } from '../api/groceries-api';

const SERVICE = 'svc-groceries';

/**
 * One receipt: the document it was read from, its lines, your own name for
 * it, and "Not groceries" for one that is not (software or AI credits): it
 * leaves the Groceries page and stays matched and filed in Money.
 */
@Component({
  selector: 'groceries-receipt-dialog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [EntityLink, UiAlert, UiBadge, UiButton, UiDialog, UiIcon],
  template: `
    <ui-dialog
      [(open)]="open"
      [heading]="heading()"
      size="md"
      [dismissible]="!busy()"
    >
      @if (receipt(); as r) {
        <form
          class="form"
          [id]="formId"
          novalidate
          (submit)="$event.preventDefault(); save(r)"
        >
          <label class="field">
            <span class="label">Name</span>
            <input
              class="ui-input"
              maxlength="120"
              [placeholder]="r.merchant.name"
              [value]="title()"
              (input)="title.set($any($event.target).value)"
            />
            <small class="hint">Empty shows the shop's name.</small>
          </label>
        </form>

        <dl class="li-facts">
          <div>
            <dt>Shop</dt>
            <dd>
              <li-entity-link kind="organization" [name]="r.merchant.name" />
            </dd>
          </div>
          <div>
            <dt>Day</dt>
            <dd>{{ dateText(r.purchasedAt) }}</dd>
          </div>
          <div>
            <dt>Total</dt>
            <dd>
              <strong>{{ euro(r.total) }}</strong>
              @if (r.bankPayment; as paid) {
                <ui-badge tone="success"
                  >Paid by card {{ dateText(paid.lastDate) }}</ui-badge
                >
              }
            </dd>
          </div>
        </dl>

        <a
          uiButton
          variant="secondary"
          size="sm"
          class="document"
          [href]="api.documentUrl(r.id)"
          target="_blank"
          rel="noopener"
        >
          <ui-icon name="file" [size]="16" /> Open the document
        </a>

        @if (r.notGroceries) {
          <p class="li-muted li-small">
            Not groceries: it is off this page, and Money still matches it with
            its card payment and files what it bought.
          </p>
        }
        @if (r.items.length) {
          <div class="li-table-wrap">
            <table class="li-table">
              <thead>
                <tr>
                  <th scope="col">Line</th>
                  <th scope="col" class="li-num">Qty</th>
                  <th scope="col" class="li-num">Paid</th>
                </tr>
              </thead>
              <tbody>
                @for (i of r.items; track i.position) {
                  <tr>
                    <td>
                      {{ i.normalizedName }}
                      @if (i.rawName !== i.normalizedName) {
                        <span class="li-muted li-small">
                          · {{ i.rawName }}</span
                        >
                      }
                    </td>
                    <td class="li-num">{{ i.quantity }}</td>
                    <td class="li-num">{{ euro(i.lineTotal) }}</td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        }
      } @else if (!error()) {
        <p class="li-muted">Loading the receipt…</p>
      }
      @if (error(); as message) {
        <ui-alert tone="danger">{{ message }}</ui-alert>
      }
      <div uiDialogFooter class="footer">
        @if (receipt(); as r) {
          @if (r.notGroceries) {
            <button
              uiButton
              variant="ghost"
              type="button"
              [disabled]="busy()"
              (click)="setGroceries(r, true)"
            >
              <ui-icon name="refresh" [size]="16" /> Back to groceries
            </button>
          } @else {
            <button
              uiButton
              variant="ghost"
              type="button"
              [disabled]="busy()"
              title="Off the Groceries page; Money still matches and files it"
              (click)="setGroceries(r, false)"
            >
              <ui-icon name="x" [size]="16" /> Not groceries
            </button>
          }
        }
        <span class="spacer"></span>
        <button
          uiButton
          variant="secondary"
          type="button"
          [disabled]="busy()"
          (click)="open.set(false)"
        >
          Cancel
        </button>
        <button
          uiButton
          type="submit"
          [attr.form]="formId"
          [loading]="busy()"
          [disabled]="!receipt()"
        >
          Save
        </button>
      </div>
    </ui-dialog>
  `,
  styles: `
    .form {
      margin-bottom: var(--space-4);
    }
    .field {
      display: grid;
      gap: var(--space-1);
    }
    .label {
      color: var(--text-secondary);
      font-size: var(--text-xs);
      font-weight: 600;
    }
    .hint {
      color: var(--text-muted);
      font-size: var(--text-xs);
    }
    .document {
      margin: var(--space-3) 0 var(--space-4);
    }
    .footer {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: var(--space-2);
      width: 100%;
    }
    .spacer {
      flex: 1;
    }
  `,
})
export class ReceiptDialog {
  protected readonly api = inject(GroceriesApi);

  readonly open = model(false);
  readonly receiptId = input<string | null>(null);
  /** Something changed: reload the page. */
  readonly changed = output<void>();

  private static next = 0;
  protected readonly formId = `groceries-receipt-form-${ReceiptDialog.next++}`;
  protected readonly euro = euro;
  protected readonly dateText = dateText;

  protected readonly receipt = signal<ReceiptDetailDto | null>(null);
  protected readonly title = signal('');
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);

  protected heading(): string {
    const r = this.receipt();
    return r ? r.title || r.merchant.name : 'Receipt';
  }

  constructor() {
    // Read afresh each time it opens on a receipt.
    effect(() => {
      const id = this.receiptId();
      if (!this.open() || !id) return;
      untracked(() => this.load(id));
    });
  }

  private load(id: string): void {
    this.receipt.set(null);
    this.error.set(null);
    this.api.receipt(id).subscribe({
      next: (r) => {
        this.receipt.set(r);
        this.title.set(r.title ?? '');
      },
      error: (error: unknown) =>
        this.error.set(
          errorText(error, 'Could not read the receipt.', SERVICE),
        ),
    });
  }

  protected save(r: ReceiptDetailDto): void {
    this.run(
      this.api.updateReceipt(r.id, { title: this.title().trim() || null }),
      'Could not save it.',
    );
  }

  /** Off the Groceries page (or back on it); Money keeps it either way. */
  protected setGroceries(r: ReceiptDetailDto, groceries: boolean): void {
    this.run(
      this.api.updateReceipt(r.id, { notGroceries: !groceries }),
      'Could not move it.',
    );
  }

  private run(call: Observable<unknown>, fallback: string): void {
    this.busy.set(true);
    this.error.set(null);
    call.subscribe({
      next: () => {
        this.busy.set(false);
        this.open.set(false);
        this.changed.emit();
      },
      error: (error: unknown) => {
        this.busy.set(false);
        this.error.set(errorText(error, fallback, SERVICE));
      },
    });
  }
}
