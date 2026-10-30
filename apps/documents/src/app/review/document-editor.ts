import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  linkedSignal,
  model,
  output,
  signal,
} from '@angular/core';
import { rxResource } from '@angular/core/rxjs-interop';
import type {
  CategorySuggestionDto,
  ExtractedField,
  UpdateUploadRequest,
  UploadDto,
} from '@life-island/contracts';
import { CONFIRMABLE_STATUSES } from '@life-island/contracts/constants';
import {
  UiAlert,
  UiButton,
  UiConfirmDialog,
  UiFormField,
  UiIcon,
  UiInput,
} from '@life-island/design-system';
import { firstValueFrom, of } from 'rxjs';
import { IngestionApi } from '../api/ingestion-api';
import { ReviewApi } from '../api/review-api';
import { CategoryStore, errorMessage } from '../categories/category-store';

/** What changed, for the inbox to show at once (the review service catches up a moment later). */
export interface DocumentChanges {
  uploadId: string;
  title: string;
  description: string | null;
  categories: string[];
}

/** A field value as the text in its input. */
export function fieldText(field: ExtractedField): string {
  if (field.value === null) return '';
  if (typeof field.value === 'boolean') return field.value ? 'yes' : 'no';
  return String(field.value);
}

/** The edits worth sending: only what differs from the stored document. */
export function uploadChanges(
  upload: UploadDto,
  form: {
    title: string;
    description: string;
    categories: string[];
    fields: Record<string, string>;
  },
): UpdateUploadRequest {
  const changes: UpdateUploadRequest = {};
  if (form.title.trim() !== upload.title) changes.title = form.title.trim();
  if (form.description.trim() !== (upload.description ?? ''))
    changes.description = form.description.trim() || null;
  if (form.categories.join() !== upload.categories.join())
    changes.categories = form.categories;
  const fields: Record<string, string | null> = {};
  for (const [key, field] of Object.entries(
    upload.extractedFields?.fields ?? {},
  )) {
    const text = form.fields[key];
    if (text !== undefined && text.trim() !== fieldText(field))
      fields[key] = text.trim() || null;
  }
  if (Object.keys(fields).length) changes.fields = fields;
  return changes;
}

const INPUT_TYPES: Partial<Record<ExtractedField['type'], string>> = {
  date: 'date',
};

/** Hints at the format each field type accepts. */
const PLACEHOLDERS: Partial<Record<ExtractedField['type'], string>> = {
  amount: '0.00',
  number: '0',
  integer: '0',
  currency: 'EUR',
  datetime: 'YYYY-MM-DDTHH:MM',
  period: 'YYYY-MM-DD/YYYY-MM-DD',
  boolean: 'yes or no',
};

/**
 * Edit everything about a document: title, description, which confirmed
 * categories it has, the extracted field values and, before you confirm it,
 * the details sent to its module.
 */
@Component({
  selector: 'app-document-editor',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [UiAlert, UiButton, UiConfirmDialog, UiFormField, UiIcon, UiInput],
  templateUrl: './document-editor.html',
  styleUrl: './document-editor.css',
})
export class DocumentEditor {
  private readonly review = inject(ReviewApi);
  private readonly ingestion = inject(IngestionApi);
  protected readonly store = inject(CategoryStore);

  readonly recordId = input<string | null>(null);
  readonly open = model(false);
  readonly saved = output<DocumentChanges>();

  protected readonly record = rxResource({
    params: () => (this.open() ? this.recordId() : null),
    stream: ({ params: id }) => (id ? this.review.get(id) : of(null)),
  });
  protected readonly upload = rxResource({
    params: () => this.record.value()?.uploadId ?? null,
    stream: ({ params: id }) => (id ? this.ingestion.get(id) : of(null)),
  });

  protected readonly title = linkedSignal(
    () => this.upload.value()?.title ?? '',
  );
  protected readonly description = linkedSignal(
    () => this.upload.value()?.description ?? '',
  );
  protected readonly categories = linkedSignal(() => [
    ...(this.upload.value()?.categories ?? []),
  ]);
  protected readonly fields = computed(() =>
    Object.entries(this.upload.value()?.extractedFields?.fields ?? {}).map(
      ([key, field]) => ({ key, ...field }),
    ),
  );
  protected readonly fieldValues = linkedSignal(() =>
    Object.fromEntries(
      this.fields().map((field) => [field.key, fieldText(field)]),
    ),
  );
  protected readonly detailsEditable = computed(() => {
    const record = this.record.value();
    return !!record && CONFIRMABLE_STATUSES.includes(record.status);
  });
  private readonly originalDetails = computed(() =>
    JSON.stringify(this.record.value()?.details ?? null, null, 2),
  );
  protected readonly details = linkedSignal(() => this.originalDetails());

  /** Pending suggestions for this document, which you can confirm from here. */
  protected readonly suggestions = computed<CategorySuggestionDto[]>(() => {
    const uploadId = this.upload.value()?.id;
    return (this.store.suggested.value() ?? []).filter(
      (suggestion) => !!uploadId && suggestion.uploadIds.includes(uploadId),
    );
  });

  protected readonly saving = signal(false);
  protected readonly confirming = signal<string | null>(null);
  protected readonly error = signal('');
  protected readonly inputTypes = INPUT_TYPES;
  protected readonly placeholders = PLACEHOLDERS;

  protected toggleCategory(id: string, event: Event): void {
    const checked = (event.target as HTMLInputElement).checked;
    this.categories.update((ids) =>
      checked
        ? [...ids.filter((existing) => existing !== id), id]
        : ids.filter((existing) => existing !== id),
    );
  }

  protected setField(key: string, event: Event): void {
    const value = (event.target as HTMLInputElement).value;
    this.fieldValues.update((values) => ({ ...values, [key]: value }));
  }

  protected text(event: Event): string {
    return (event.target as HTMLInputElement).value;
  }

  /** Confirms the suggested category for every document that suggested it, this one included. */
  protected async confirmSuggestion(
    suggestion: CategorySuggestionDto,
  ): Promise<void> {
    this.confirming.set(suggestion.id);
    this.error.set('');
    try {
      const approved = await firstValueFrom(
        this.ingestion.approveSuggestion(suggestion.id),
      );
      const id = approved.approvedCategoryId ?? suggestion.categoryId;
      this.categories.update((ids) => (ids.includes(id) ? ids : [...ids, id]));
      this.store.reload();
    } catch (error) {
      this.error.set(errorMessage(error));
    } finally {
      this.confirming.set(null);
    }
  }

  protected async save(): Promise<void> {
    const record = this.record.value();
    const upload = this.upload.value();
    if (!record || !upload) return;
    this.error.set('');
    let details: unknown;
    const detailsChanged =
      this.detailsEditable() && this.details() !== this.originalDetails();
    if (detailsChanged) {
      try {
        details = JSON.parse(this.details());
      } catch {
        this.error.set('The details are not valid JSON.');
        return;
      }
    }
    const changes = uploadChanges(upload, {
      title: this.title(),
      description: this.description(),
      categories: this.categories(),
      fields: this.fieldValues(),
    });
    this.saving.set(true);
    try {
      let saved = upload;
      if (Object.keys(changes).length)
        saved = await firstValueFrom(
          this.ingestion.updateUpload(upload.id, changes),
        );
      if (detailsChanged)
        await firstValueFrom(this.review.update(record.id, { details }));
      this.saved.emit({
        uploadId: saved.id,
        title: saved.title,
        description: saved.description,
        categories: saved.categories,
      });
      this.open.set(false);
    } catch (error) {
      this.error.set(errorMessage(error));
    } finally {
      this.saving.set(false);
    }
  }

  protected onClosed(): void {
    this.error.set('');
  }
}
