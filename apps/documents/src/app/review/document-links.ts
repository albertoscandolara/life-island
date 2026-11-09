import { DatePipe, DecimalPipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { rxResource } from '@angular/core/rxjs-interop';
import type {
  DocumentLinkDto,
  DocumentLinkStatus,
  LinkedDocumentDto,
  TransactionRole,
} from '@life-island/contracts';
import {
  UiAlert,
  UiBadge,
  UiButton,
  type UiTone,
} from '@life-island/design-system';
import { firstValueFrom, of } from 'rxjs';
import { IngestionApi } from '../api/ingestion-api';
import { errorMessage } from '../categories/category-store';

export const ROLE_LABELS: Record<TransactionRole, string> = {
  INVOICE: 'Invoice',
  QUOTE: 'Quote',
  PAYMENT: 'Payment',
  NONE: 'No payment data',
};

export const LINK_STATUS_VIEW: Record<
  DocumentLinkStatus,
  { label: string; tone: UiTone }
> = {
  AUTO: { label: 'Matched', tone: 'success' },
  CONFIRMED: { label: 'Confirmed', tone: 'success' },
  SUGGESTED: { label: 'To check', tone: 'warning' },
  REJECTED: { label: 'Not a match', tone: 'neutral' },
};

/**
 * A document's place in a money transaction: what the AI read about it (an
 * invoice, a quote, a payment) and the documents on the other side, matched
 * from their content. Matches to check can be confirmed or unlinked, and any
 * document can be linked by hand.
 */
@Component({
  selector: 'app-document-links',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DatePipe, DecimalPipe, UiAlert, UiBadge, UiButton],
  template: `
    @if (links.value(); as data) {
      @if (data.facts && data.facts.role !== 'NONE') {
        <h3 class="section-title">{{ heading() }}</h3>
        <p class="muted small">
          Read as {{ roleLabel(data.facts.role).toLowerCase() }}
          @if (data.facts.counterparty.name; as who) {
            {{ isPayment() ? 'to' : 'from' }} {{ who }}
          }
          @if (data.facts.amount !== null) {
            · {{ data.facts.amount | number: '1.2-2' }}
            {{ data.facts.currency ?? '' }}
          }
          @if (data.linkedTotal !== null && data.facts.amount !== null) {
            · {{ isPayment() ? 'covers' : 'paid' }}
            {{ data.linkedTotal | number: '1.2-2' }} so far
          }
        </p>
        @if (error()) {
          <ui-alert tone="danger" class="spaced">{{ error() }}</ui-alert>
        }
        @for (link of data.links; track link.id) {
          @let other = otherSide(link);
          <div class="link-row">
            <div class="link-main">
              <ui-badge [tone]="statusView[link.status].tone">{{
                statusView[link.status].label
              }}</ui-badge>
              <strong>{{ other.title }}</strong>
              <span class="muted small-inline">
                {{ roleLabel(other.role) }}
                @if (other.documentNumber) {
                  n. {{ other.documentNumber }}
                }
                @if (other.date) {
                  · {{ other.date | date: 'dd MMM yyyy' }}
                }
                @if (other.amount !== null) {
                  · {{ other.amount | number: '1.2-2' }}
                  {{ other.currency ?? '' }}
                }
              </span>
            </div>
            <ul class="reasons muted small-inline">
              @for (reason of link.reasons; track $index) {
                <li>{{ reason }}</li>
              }
            </ul>
            <div class="link-actions">
              @if (link.status === 'SUGGESTED' || link.status === 'AUTO') {
                <button
                  uiButton
                  size="sm"
                  [variant]="link.status === 'SUGGESTED' ? 'primary' : 'ghost'"
                  type="button"
                  [disabled]="busy()"
                  (click)="act(link, 'confirm')"
                >
                  {{ link.status === 'SUGGESTED' ? 'It’s a match' : 'Confirm' }}
                </button>
              }
              <button
                uiButton
                size="sm"
                variant="ghost"
                type="button"
                [disabled]="busy()"
                (click)="act(link, 'reject')"
              >
                {{ link.status === 'SUGGESTED' ? 'Not a match' : 'Unlink' }}
              </button>
            </div>
          </div>
        } @empty {
          <p class="muted small">
            {{
              isPayment()
                ? 'No invoice matches this payment yet. It is checked again whenever a document is read.'
                : 'No payment matches it yet. It is checked again whenever a document is read.'
            }}
          </p>
        }
        @if (picking()) {
          <div class="picker">
            @if (candidates.isLoading()) {
              <p class="muted small">Loading…</p>
            } @else {
              <select
                class="ui-input"
                [disabled]="busy()"
                (change)="pick($event)"
                [attr.aria-label]="
                  isPayment() ? 'Invoice it pays' : 'Payment that pays it'
                "
              >
                <option value="">
                  {{
                    isPayment()
                      ? 'Choose the invoice it pays…'
                      : 'Choose the payment…'
                  }}
                </option>
                @for (
                  candidate of candidates.value() ?? [];
                  track candidate.document.uploadId
                ) {
                  <option [value]="candidate.document.uploadId">
                    {{ describe(candidate.document) }}
                  </option>
                }
              </select>
            }
            <button
              uiButton
              size="sm"
              variant="ghost"
              type="button"
              (click)="picking.set(false)"
            >
              Cancel
            </button>
          </div>
        } @else {
          <button type="button" class="link small" (click)="picking.set(true)">
            {{
              isPayment() ? 'Link an invoice by hand' : 'Link a payment by hand'
            }}
          </button>
        }
      }
    }
  `,
  styles: `
    :host {
      display: block;
    }
    .section-title {
      margin: var(--space-5) 0 var(--space-2);
      padding-top: var(--space-3);
      border-top: 1px solid var(--border-subtle);
      font-size: var(--text-md);
    }
    .muted {
      color: var(--text-muted);
    }
    .small {
      margin: var(--space-1) 0 0;
      font-size: var(--text-xs);
    }
    .small-inline {
      font-size: var(--text-xs);
    }
    .spaced {
      margin-top: var(--space-3);
    }
    .link {
      padding: 0;
      border: 0;
      background: none;
      color: var(--accent);
      font: inherit;
      text-decoration: underline;
      cursor: pointer;
    }
    .link-row {
      display: grid;
      gap: var(--space-1);
      margin-top: var(--space-2);
      padding: var(--space-2) var(--space-3);
      border: 1px solid var(--border-subtle);
      border-radius: var(--radius-md);
    }
    .link-main {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: var(--space-2);
    }
    .reasons {
      margin: 0;
      padding-left: var(--space-4);
    }
    .link-actions,
    .picker {
      display: flex;
      flex-wrap: wrap;
      gap: var(--space-2);
      margin-top: var(--space-2);
    }
    .picker select {
      flex: 1 1 16rem;
      min-width: 0;
    }
  `,
})
export class DocumentLinks {
  private readonly api = inject(IngestionApi);

  readonly uploadId = input<string | null>(null);
  /** Something changed: a link was confirmed, unlinked or made. */
  readonly changed = output<void>();

  protected readonly statusView = LINK_STATUS_VIEW;
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly picking = signal(false);

  protected readonly links = rxResource({
    params: () => this.uploadId(),
    stream: ({ params: id }) => (id ? this.api.links(id) : of(null)),
  });
  protected readonly candidates = rxResource({
    params: () => (this.picking() ? this.uploadId() : null),
    stream: ({ params: id }) => (id ? this.api.linkCandidates(id) : of([])),
  });

  protected readonly isPayment = computed(
    () => this.links.value()?.facts?.role === 'PAYMENT',
  );
  protected readonly heading = computed(() =>
    this.isPayment() ? 'What it pays' : 'Paid by',
  );

  protected roleLabel(role: TransactionRole): string {
    return ROLE_LABELS[role];
  }

  protected otherSide(link: DocumentLinkDto): LinkedDocumentDto {
    return link.invoiceUploadId === this.uploadId()
      ? link.payment
      : link.invoice;
  }

  protected describe(document: LinkedDocumentDto): string {
    return [
      document.title,
      document.counterparty,
      document.amount !== null
        ? `${document.amount.toFixed(2)} ${document.currency ?? ''}`.trim()
        : null,
      document.date,
    ]
      .filter(Boolean)
      .join(' · ');
  }

  protected act(link: DocumentLinkDto, action: 'confirm' | 'reject'): void {
    void this.run(() =>
      firstValueFrom(
        action === 'confirm'
          ? this.api.confirmLink(link.id)
          : this.api.rejectLink(link.id),
      ),
    );
  }

  protected pick(event: Event): void {
    const otherId = (event.target as HTMLSelectElement).value;
    const id = this.uploadId();
    if (!otherId || !id) return;
    const [invoiceId, paymentId] = this.isPayment()
      ? [otherId, id]
      : [id, otherId];
    void this.run(async () => {
      await firstValueFrom(this.api.linkDocuments(invoiceId, paymentId));
      this.picking.set(false);
    });
  }

  private async run(action: () => Promise<unknown>): Promise<void> {
    this.busy.set(true);
    this.error.set(null);
    try {
      await action();
      this.links.reload();
      this.changed.emit();
    } catch (error) {
      this.error.set(errorMessage(error));
    } finally {
      this.busy.set(false);
    }
  }
}
