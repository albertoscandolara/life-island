import {
  ChangeDetectionStrategy,
  Component,
  effect,
  inject,
  input,
  model,
  output,
  signal,
} from '@angular/core';
import type {
  Tax730AttachmentRole,
  Tax730DocumentCandidateDto,
} from '@life-island/contracts';
import {
  UiBadge,
  UiButton,
  UiDialog,
  UiEmptyState,
  UiIcon,
  UiInput,
} from '@life-island/design-system';
import { debounceTime, Subject, switchMap } from 'rxjs';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Tax730Api } from '../api/tax730-api';
import { formatDate, formatEuro, ROLE_LABELS } from '../dashboard/format';

export interface PickedDocument {
  uploadId: string;
  role: Tax730AttachmentRole;
}

/**
 * Pick one of your uploaded documents to file with an expense or a year.
 * For an expense, likely payment proofs come first with the reasons why.
 */
@Component({
  selector: 'tax-document-picker',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [UiDialog, UiButton, UiBadge, UiIcon, UiInput, UiEmptyState],
  templateUrl: './document-picker.html',
  styleUrl: './document-picker.css',
})
export class DocumentPicker {
  private readonly api = inject(Tax730Api);

  readonly open = model(false);
  readonly heading = input('Add a document');
  /** Rank documents for this expense; none lists your newest documents. */
  readonly forExpense = input<string | null>(null);
  readonly roles = input<Tax730AttachmentRole[]>([
    'PAYMENT',
    'INVOICE',
    'OTHER',
  ]);
  readonly picked = output<PickedDocument>();

  protected readonly role = signal<Tax730AttachmentRole>('PAYMENT');
  protected readonly search = signal('');
  protected readonly loading = signal(false);
  protected readonly results = signal<Tax730DocumentCandidateDto[]>([]);
  protected readonly roleLabels = ROLE_LABELS;
  protected readonly formatDate = formatDate;
  protected readonly formatEuro = formatEuro;
  protected readonly previewUrl = (id: string) => this.api.previewUrl(id);

  private readonly queries = new Subject<void>();

  constructor() {
    this.queries
      .pipe(
        debounceTime(200),
        switchMap(() => {
          this.loading.set(true);
          return this.api.documents({
            search: this.search() || undefined,
            forExpense: this.forExpense() ?? undefined,
          });
        }),
        takeUntilDestroyed(),
      )
      .subscribe({
        next: (documents) => {
          this.results.set(documents);
          this.loading.set(false);
        },
        error: () => this.loading.set(false),
      });

    effect(() => {
      if (!this.open()) return;
      this.role.set(this.roles()[0]);
      this.search.set('');
      this.results.set([]);
      this.queries.next();
    });
  }

  protected onSearch(value: string): void {
    this.search.set(value);
    this.queries.next();
  }

  protected pick(document: Tax730DocumentCandidateDto): void {
    this.picked.emit({ uploadId: document.uploadId, role: this.role() });
    this.open.set(false);
  }
}
