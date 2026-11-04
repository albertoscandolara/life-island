import {
  ChangeDetectionStrategy,
  Component,
  effect,
  inject,
  model,
  output,
  signal,
} from '@angular/core';
import type { HomeDocumentDto } from '@life-island/contracts';
import {
  UiAlert,
  UiButton,
  UiDialog,
  UiIcon,
  UiInput,
} from '@life-island/design-system';
import { debounceTime, Subject, switchMap } from 'rxjs';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { errorMessage, HomeApi } from '../api/home-api';
import { formatDate, formatEuro } from '../shared/format';

/** Pick one of your documents (an invoice, a quote, a photo) to file with a work. */
@Component({
  selector: 'home-document-picker',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [UiDialog, UiButton, UiIcon, UiInput, UiAlert],
  template: `
    <ui-dialog [(open)]="open" heading="File a document" size="md">
      <input
        uiInput
        type="search"
        placeholder="Search your documents by title"
        [value]="query()"
        (input)="search($event)"
      />
      @if (error(); as message) {
        <ui-alert tone="danger" class="error">{{ message }}</ui-alert>
      }
      <ul class="list" role="list">
        @for (doc of results(); track doc.uploadId) {
          <li>
            <button
              type="button"
              class="doc"
              (click)="picked.emit(doc); open.set(false)"
            >
              <ui-icon name="file" [size]="18" />
              <span class="doc__title">{{ doc.title }}</span>
              <span class="doc__meta">
                {{
                  doc.date ? formatDate(doc.date) : formatDate(doc.uploadedAt)
                }}
                @if (doc.amount !== null) {
                  · {{ formatEuro(doc.amount) }}
                }
              </span>
            </button>
          </li>
        } @empty {
          <li class="muted">No documents match.</li>
        }
      </ul>
      <div uiDialogFooter>
        <button
          uiButton
          variant="secondary"
          type="button"
          (click)="open.set(false)"
        >
          Close
        </button>
      </div>
    </ui-dialog>
  `,
  styles: `
    .error {
      margin-top: var(--space-3);
    }
    .list {
      display: grid;
      gap: var(--space-1);
      max-height: 22rem;
      margin: var(--space-3) 0 0;
      padding: 0;
      overflow-y: auto;
      list-style: none;
    }
    .doc {
      display: grid;
      grid-template-columns: auto 1fr auto;
      align-items: center;
      gap: var(--space-3);
      width: 100%;
      padding: var(--space-2) var(--space-3);
      border: 1px solid transparent;
      border-radius: var(--radius-sm);
      background: none;
      color: var(--text-primary);
      font: inherit;
      text-align: left;
      cursor: pointer;
    }
    .doc:hover {
      border-color: var(--accent);
      background: var(--accent-soft);
    }
    .doc__title {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .doc__meta,
    .muted {
      color: var(--text-muted);
      font-size: var(--text-sm);
    }
  `,
})
export class DocumentPicker {
  private readonly api = inject(HomeApi);

  readonly open = model(false);
  readonly picked = output<HomeDocumentDto>();

  protected readonly query = signal('');
  protected readonly results = signal<HomeDocumentDto[]>([]);
  protected readonly error = signal<string | null>(null);
  protected readonly formatDate = formatDate;
  protected readonly formatEuro = formatEuro;

  private readonly searches = new Subject<string>();

  constructor() {
    this.searches
      .pipe(
        debounceTime(200),
        switchMap((query) => this.api.documents(query)),
        takeUntilDestroyed(),
      )
      .subscribe({
        next: (docs) => {
          this.error.set(null);
          this.results.set(docs);
        },
        error: (error) => this.error.set(errorMessage(error)),
      });
    effect(() => {
      if (this.open()) this.searches.next(this.query());
    });
  }

  protected search(event: Event): void {
    this.query.set((event.target as HTMLInputElement).value);
    this.searches.next(this.query());
  }
}
