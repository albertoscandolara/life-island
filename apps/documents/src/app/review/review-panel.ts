import { DatePipe, PercentPipe } from '@angular/common';
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
import { DomSanitizer } from '@angular/platform-browser';
import type {
  CategorySuggestionDto,
  RecordDetailDto,
  TargetCatalogEntryDto,
} from '@life-island/contracts';
import { toggleCategory } from '@life-island/contracts/category-tree';
import {
  CONFIRMABLE_STATUSES,
  LOADING_MODULES,
  MODULE_LABELS,
  PREVIEWABLE_FORMATS,
  REJECTABLE_STATUSES,
  SINGLE_VALUED_DIMENSIONS,
  type CategoryDimension,
} from '@life-island/contracts/constants';
import {
  UiAlert,
  UiBadge,
  UiButton,
  UiDialog,
  UiFormField,
  UiIcon,
  UiInput,
  UiStatusDot,
} from '@life-island/design-system';
import { firstValueFrom, of } from 'rxjs';
import { IngestionApi } from '../api/ingestion-api';
import { ReviewApi } from '../api/review-api';
import { DIMENSION_GROUPS } from '../categories/category-rows';
import { CategoryStore, errorMessage } from '../categories/category-store';
import { DetailsForm } from './details-form';
import {
  cleanDetails,
  emptyValue,
  type JsonSchema,
  type JsonValue,
} from './details-form-model';
import { DetailsView, humanize, type SchemaShape } from './details-view';
import {
  fieldText,
  uploadChanges,
  type DocumentChanges,
} from './document-changes';
import { ProcessingPanel } from './processing-panel';
import { RECORD_STATUS_VIEW } from './record-status';

/** What the inbox needs to know after an action in the panel. */
export type ReviewOutcome =
  | { kind: 'saved'; changes: DocumentChanges }
  | { kind: 'status'; record: RecordDetailDto; changes?: DocumentChanges }
  | { kind: 'deleted'; recordId: string };

/** "Groceries · Grocery receipt": a target as a choice of module. */
export function targetLabel(target: TargetCatalogEntryDto): string {
  const module = MODULE_LABELS[target.category] ?? humanize(target.category);
  return `${module} · ${target.label}`;
}

/** The details as the server would store them, for comparing. */
function canonical(value: unknown, schema: JsonSchema | undefined): string {
  const cleaned = schema
    ? cleanDetails(value as JsonValue, schema)
    : (value as JsonValue);
  return JSON.stringify(cleaned ?? null, (_key, item: unknown) =>
    item && typeof item === 'object' && !Array.isArray(item)
      ? Object.fromEntries(
          Object.entries(item).sort(([a], [b]) => a.localeCompare(b)),
        )
      : item,
  );
}

/**
 * Everything about reviewing one document, in one place: the original file,
 * its title and categories (with the AI's suggestions to accept or decline
 * for this document), the fields kept with it, and the details sent to its
 * module, as a form. The footer holds the decisions: Confirm (and next),
 * Reject or Reopen, Delete.
 */
@Component({
  selector: 'app-review-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    DatePipe,
    DetailsForm,
    DetailsView,
    PercentPipe,
    ProcessingPanel,
    UiAlert,
    UiBadge,
    UiButton,
    UiDialog,
    UiFormField,
    UiIcon,
    UiInput,
    UiStatusDot,
  ],
  templateUrl: './review-panel.html',
  styleUrl: './review-panel.css',
})
export class ReviewPanel {
  private readonly review = inject(ReviewApi);
  private readonly ingestion = inject(IngestionApi);
  private readonly sanitizer = inject(DomSanitizer);
  protected readonly store = inject(CategoryStore);

  readonly recordId = input<string | null>(null);
  /** The next record waiting for review, for Confirm and next; null when none. */
  readonly nextRecordId = input<string | null>(null);
  readonly open = model(false);
  readonly changed = output<ReviewOutcome>();
  /** Asks the inbox to show `nextRecordId`. */
  readonly advance = output<void>();

  protected readonly record = rxResource({
    params: () => (this.open() ? this.recordId() : null),
    stream: ({ params: id }) => (id ? this.review.get(id) : of(null)),
  });
  protected readonly upload = rxResource({
    params: () => this.record.value()?.uploadId ?? null,
    stream: ({ params: id }) => (id ? this.ingestion.get(id) : of(null)),
  });
  private readonly catalog = rxResource({
    stream: () => this.review.catalog(),
  });

  protected readonly statusView = RECORD_STATUS_VIEW;
  protected readonly busy = signal<string | null>(null);
  protected readonly error = signal('');
  protected readonly confirmingDelete = signal(false);
  protected readonly rejecting = signal(false);
  protected readonly rejectReason = signal('');
  protected readonly jsonMode = signal(false);
  protected readonly showOriginal = signal(false);

  // ---- document ------------------------------------------------------------

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
  protected readonly parsing = computed(
    () => this.upload.value()?.status === 'PARSING',
  );

  protected readonly previewKind = computed(() => {
    const format = this.upload.value()?.fileFormat;
    if (!format || !PREVIEWABLE_FORMATS.includes(format)) return 'none';
    return format === 'JPG' || format === 'PNG' || format === 'WEBP'
      ? 'image'
      : 'frame';
  });
  protected readonly previewUrl = computed(() => {
    const id = this.record.value()?.uploadId;
    return id ? this.ingestion.previewUrl(id) : '';
  });
  /** Our own API path, so it is safe to load in a frame. */
  protected readonly frameUrl = computed(() =>
    this.sanitizer.bypassSecurityTrustResourceUrl(this.previewUrl()),
  );

  /** The confirmed categories by dimension, each in tree order with its depth. */
  protected readonly categoryGroups = computed(() => {
    const tree = this.store.hierarchy();
    return DIMENSION_GROUPS.map((group) => ({
      ...group,
      single:
        group.key !== null && SINGLE_VALUED_DIMENSIONS.includes(group.key),
      categories: tree.roots
        .filter((root) => (root.dimension ?? null) === group.key)
        .flatMap((root) => [root, ...tree.descendants(root.id)])
        .map((category) => ({
          category,
          parent: category.parentId
            ? this.store.titleOf(category.parentId)
            : null,
          path: `${this.store.pathOf(category.id)} (${category.id})`,
        })),
    })).filter((group) => group.categories.length);
  });

  /** Pending suggestions for this document, to accept or decline here. */
  protected readonly suggestions = computed<CategorySuggestionDto[]>(() => {
    const uploadId = this.upload.value()?.id;
    return (this.store.suggested.value() ?? []).filter(
      (suggestion) => !!uploadId && suggestion.uploadIds.includes(uploadId),
    );
  });

  // ---- module and details --------------------------------------------------

  protected readonly targets = computed(() => this.catalog.value() ?? []);
  protected readonly editable = computed(() => {
    const record = this.record.value();
    return !!record && CONFIRMABLE_STATUSES.includes(record.status);
  });
  protected readonly targetKey = linkedSignal(
    () => this.record.value()?.targetKey ?? null,
  );
  protected readonly target = computed(() =>
    this.targets().find((entry) => entry.targetKey === this.targetKey()),
  );
  protected readonly schema = computed(
    () => this.target()?.jsonSchema as JsonSchema | undefined,
  );
  protected readonly moduleLabel = computed(() => {
    const category = this.target()?.category ?? this.record.value()?.category;
    return category
      ? (MODULE_LABELS[category] ?? humanize(category))
      : 'No module yet';
  });
  /** False for "Documents only": confirming keeps the record with the document. */
  protected readonly hasModule = computed(() => {
    const category = this.target()?.category ?? this.record.value()?.category;
    return !!category && LOADING_MODULES.includes(category);
  });
  /** Your details: the stored ones for the stored target, an empty form for another. */
  protected readonly details = linkedSignal<
    { key: string | null; record: RecordDetailDto | null | undefined },
    JsonValue | undefined
  >({
    source: () => ({ key: this.targetKey(), record: this.record.value() }),
    computation: ({ key, record }) => {
      if (!record) return undefined;
      if (key === record.targetKey) return record.details as JsonValue;
      const schema = this.targets().find((t) => t.targetKey === key)
        ?.jsonSchema as JsonSchema | undefined;
      return schema ? emptyValue(schema) : undefined;
    },
  });
  protected readonly detailsJson = linkedSignal(() =>
    JSON.stringify(this.details() ?? null, null, 2),
  );
  protected readonly targetChanged = computed(
    () => this.targetKey() !== (this.record.value()?.targetKey ?? null),
  );
  protected readonly detailsChanged = computed(() => {
    const record = this.record.value();
    if (!record || !this.editable()) return false;
    return (
      this.targetChanged() ||
      canonical(this.details(), this.schema()) !==
        canonical(record.details, this.schema())
    );
  });

  protected readonly canReject = computed(() => {
    const record = this.record.value();
    return !!record && REJECTABLE_STATUSES.includes(record.status);
  });

  // ---- helpers for the template -------------------------------------------

  protected readonly targetLabel = targetLabel;

  protected flagLabel(flag: string): string {
    return humanize(flag);
  }
  protected schemaShape(): SchemaShape | undefined {
    return this.schema() as SchemaShape | undefined;
  }

  protected toggleCategory(id: string, event: Event): void {
    const checked = (event.target as HTMLInputElement).checked;
    this.categories.update((ids) =>
      toggleCategory(ids, id, checked, this.store.hierarchy()),
    );
  }

  protected singleHint(dimension: CategoryDimension | null): string {
    return dimension === 'ISSUER' ? 'one issuer' : 'one type';
  }

  protected setField(key: string, event: Event): void {
    const value = (event.target as HTMLInputElement).value;
    this.fieldValues.update((values) => ({ ...values, [key]: value }));
  }

  protected text(event: Event): string {
    return (event.target as HTMLInputElement).value;
  }

  protected setTarget(event: Event): void {
    this.targetKey.set((event.target as HTMLSelectElement).value || null);
  }

  protected toggleJson(): void {
    if (this.jsonMode()) {
      try {
        this.details.set(JSON.parse(this.detailsJson()) as JsonValue);
      } catch {
        this.error.set('The details are not valid JSON.');
        return;
      }
    } else
      this.detailsJson.set(JSON.stringify(this.details() ?? null, null, 2));
    this.error.set('');
    this.jsonMode.update((on) => !on);
  }

  // ---- actions --------------------------------------------------------------

  /** Accepts a suggestion: it becomes a category for every document that suggested it. */
  protected async acceptSuggestion(
    suggestion: CategorySuggestionDto,
  ): Promise<void> {
    await this.run(suggestion.id, async () => {
      const approved = await firstValueFrom(
        this.ingestion.approveSuggestion(suggestion.id),
      );
      const id = approved.approvedCategoryId ?? suggestion.categoryId;
      this.categories.update((ids) => (ids.includes(id) ? ids : [...ids, id]));
      this.store.reload();
    });
  }

  /** Declines a suggestion for this document only. */
  protected async declineSuggestion(
    suggestion: CategorySuggestionDto,
  ): Promise<void> {
    const uploadId = this.upload.value()?.id;
    if (!uploadId) return;
    await this.run(suggestion.id, async () => {
      await firstValueFrom(
        this.ingestion.dismissSuggestion(suggestion.id, uploadId),
      );
      this.store.reload();
    });
  }

  protected async save(): Promise<void> {
    await this.run('save', async () => {
      const changes = await this.persist();
      if (changes) this.changed.emit({ kind: 'saved', changes });
      this.open.set(false);
    });
  }

  protected async confirm(andNext: boolean): Promise<void> {
    const record = this.record.value();
    if (!record) return;
    await this.run(andNext ? 'confirm-next' : 'confirm', async () => {
      const changes = await this.persist();
      const confirmed = await firstValueFrom(this.review.confirm(record.id));
      this.changed.emit({ kind: 'status', record: confirmed, changes });
      this.finish(andNext);
    });
  }

  protected async reject(): Promise<void> {
    const record = this.record.value();
    if (!record) return;
    await this.run('reject', async () => {
      const rejected = await firstValueFrom(
        this.review.reject(record.id, {
          reason: this.rejectReason().trim() || undefined,
        }),
      );
      this.changed.emit({ kind: 'status', record: rejected });
      this.finish(true);
    });
  }

  protected async reopen(): Promise<void> {
    const record = this.record.value();
    if (!record) return;
    await this.run('reopen', async () => {
      const reopened = await firstValueFrom(this.review.reopen(record.id));
      this.changed.emit({ kind: 'status', record: reopened });
      this.record.reload();
    });
  }

  protected async remove(): Promise<void> {
    const record = this.record.value();
    if (!record) return;
    await this.run('delete', async () => {
      await firstValueFrom(this.ingestion.deleteUpload(record.uploadId));
      this.changed.emit({ kind: 'deleted', recordId: record.id });
      this.store.reload();
      this.finish(true);
    });
  }

  protected onClosed(): void {
    this.reset();
  }

  /**
   * Saves what you changed: the document (ingestion) and, before you confirm,
   * the details and module (review). Returns the document's new state.
   */
  private async persist(): Promise<DocumentChanges | undefined> {
    const record = this.record.value();
    const upload = this.upload.value();
    if (!record || !upload) return undefined;
    let details = this.details();
    if (this.jsonMode()) {
      try {
        details = JSON.parse(this.detailsJson()) as JsonValue;
      } catch {
        throw new Error('The details are not valid JSON.');
      }
    }
    const changes = uploadChanges(upload, {
      title: this.title(),
      description: this.description(),
      categories: this.categories(),
      fields: this.fieldValues(),
    });
    let saved = upload;
    if (Object.keys(changes).length)
      saved = await firstValueFrom(
        this.ingestion.updateUpload(upload.id, changes),
      );
    const schema = this.schema();
    const detailsChanged =
      this.editable() &&
      (this.targetChanged() ||
        canonical(details, schema) !== canonical(record.details, schema));
    if (detailsChanged)
      await firstValueFrom(
        this.review.update(record.id, {
          details: schema ? cleanDetails(details, schema) : details,
          ...(this.targetChanged() && this.targetKey()
            ? { targetKey: this.targetKey()! }
            : {}),
        }),
      );
    return {
      uploadId: saved.id,
      title: saved.title,
      description: saved.description,
      categories: saved.categories,
    };
  }

  /** After a decision: show the next record waiting, or close. */
  private finish(andNext: boolean): void {
    if (andNext && this.nextRecordId()) {
      this.reset();
      this.advance.emit();
    } else this.open.set(false);
  }

  private reset(): void {
    this.error.set('');
    this.confirmingDelete.set(false);
    this.rejecting.set(false);
    this.rejectReason.set('');
    this.jsonMode.set(false);
    this.showOriginal.set(false);
  }

  private async run(name: string, action: () => Promise<void>): Promise<void> {
    if (this.busy()) return;
    this.busy.set(name);
    this.error.set('');
    try {
      await action();
    } catch (error) {
      this.error.set(
        error instanceof Error && !('status' in error)
          ? error.message
          : errorMessage(error),
      );
    } finally {
      this.busy.set(null);
    }
  }
}
