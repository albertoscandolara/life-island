import { DatePipe, DecimalPipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  inject,
  signal,
} from '@angular/core';
import { rxResource } from '@angular/core/rxjs-interop';
import type {
  DocumentLinkDto,
  LinkedDocumentDto,
} from '@life-island/contracts';
import { UiAlert, UiButton } from '@life-island/design-system';
import { firstValueFrom } from 'rxjs';
import { INGESTION_API, IngestionApi } from '../api/ingestion-api';
import { errorMessage } from '../categories/category-store';
import { ROLE_LABELS } from './document-links';

/**
 * Invoice and payment matches the matcher would not make on its own (thin
 * evidence, or several invoices could fit one payment), for you to check:
 * confirm the right one, turn down the wrong ones.
 */
@Component({
  selector: 'app-link-checks',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DatePipe, DecimalPipe, UiAlert, UiButton],
  template: `
    @if (checks.value()?.length) {
      <ui-alert tone="warning" role="status">
        <strong class="heading"
          >{{ checks.value()!.length }} invoice and payment
          {{ checks.value()!.length === 1 ? 'match' : 'matches' }} to
          check</strong
        >
        <p>
          The evidence was not enough to link them on their own. Confirm the
          right ones; the others are never proposed again.
        </p>
        @if (error()) {
          <p class="error">{{ error() }}</p>
        }
        <ul class="checks">
          @for (link of checks.value(); track link.id) {
            <li>
              <div>
                <a
                  [href]="preview(link.payment)"
                  target="_blank"
                  rel="noopener"
                  >{{ link.payment.title }}</a
                >
                <span class="muted">{{ summary(link.payment) }}</span>
                →
                <a
                  [href]="preview(link.invoice)"
                  target="_blank"
                  rel="noopener"
                  >{{ link.invoice.title }}</a
                >
                <span class="muted">{{ summary(link.invoice) }}</span>
              </div>
              <div class="muted small">{{ link.reasons.join(' · ') }}</div>
              <div class="actions">
                <button
                  uiButton
                  size="sm"
                  type="button"
                  [disabled]="busy()"
                  (click)="decide(link, 'confirm')"
                >
                  It’s a match
                </button>
                <button
                  uiButton
                  size="sm"
                  variant="ghost"
                  type="button"
                  [disabled]="busy()"
                  (click)="decide(link, 'reject')"
                >
                  Not a match
                </button>
              </div>
            </li>
          }
        </ul>
      </ui-alert>
    }
  `,
  styles: `
    :host {
      display: block;
    }
    :host:empty {
      display: none;
    }
    ui-alert {
      margin-bottom: var(--space-4);
    }
    .heading {
      display: block;
    }
    p {
      margin: var(--space-1) 0 0;
    }
    .checks {
      display: grid;
      gap: var(--space-3);
      margin: var(--space-3) 0 0;
      padding: 0;
      list-style: none;
    }
    .muted {
      color: var(--text-muted);
    }
    .checks a + .muted {
      margin-left: var(--space-1);
    }
    .small {
      font-size: var(--text-xs);
    }
    .error {
      color: var(--danger);
    }
    .actions {
      display: flex;
      flex-wrap: wrap;
      gap: var(--space-2);
      margin-top: var(--space-1);
    }
  `,
})
export class LinkChecks {
  private readonly api = inject(IngestionApi);
  private readonly number = new DecimalPipe('en-GB');
  private readonly date = new DatePipe('en-GB');

  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly checks = rxResource({
    stream: () => this.api.documentLinks('SUGGESTED', 20),
  });

  reload(): void {
    this.checks.reload();
  }

  protected preview(document: LinkedDocumentDto): string {
    return `${INGESTION_API}/uploads/${document.uploadId}/preview`;
  }

  protected summary(document: LinkedDocumentDto): string {
    const parts = [
      ROLE_LABELS[document.role].toLowerCase(),
      document.amount !== null
        ? `${this.number.transform(document.amount, '1.2-2')} ${document.currency ?? ''}`.trim()
        : null,
      document.date ? this.date.transform(document.date, 'dd MMM yyyy') : null,
    ].filter(Boolean);
    return `(${parts.join(', ')})`;
  }

  protected decide(link: DocumentLinkDto, action: 'confirm' | 'reject'): void {
    this.busy.set(true);
    this.error.set(null);
    void firstValueFrom(
      action === 'confirm'
        ? this.api.confirmLink(link.id)
        : this.api.rejectLink(link.id),
    )
      .then(() => this.checks.reload())
      .catch((error: unknown) => this.error.set(errorMessage(error)))
      .finally(() => this.busy.set(false));
  }
}
