import { DatePipe, PercentPipe } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  model,
  output,
  signal,
} from '@angular/core';
import { rxResource } from '@angular/core/rxjs-interop';
import type { RecordDetailDto } from '@life-island/contracts';
import {
  CATEGORY_LABELS,
  CONFIRMABLE_STATUSES,
} from '@life-island/contracts/constants';
import {
  UiAlert,
  UiBadge,
  UiConfirmDialog,
  UiIcon,
  UiStatusDot,
} from '@life-island/design-system';
import { firstValueFrom, of } from 'rxjs';
import { ReviewApi } from '../api/review-api';
import { DetailsView, humanize, type SchemaShape } from './details-view';
import { ProcessingPanel } from './processing-panel';
import { RECORD_STATUS_VIEW } from './record-status';

/**
 * The details popup: what the parser extracted, with Confirm and Cancel.
 * Confirm calls the review API, which emits `record.approved`; the domain
 * service of the record's category then loads it into its own table.
 */
@Component({
  selector: 'app-record-dialog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    DatePipe,
    DetailsView,
    PercentPipe,
    ProcessingPanel,
    UiAlert,
    UiBadge,
    UiConfirmDialog,
    UiIcon,
    UiStatusDot,
  ],
  templateUrl: './record-dialog.html',
  styleUrl: './record-dialog.css',
})
export class RecordDialog {
  private readonly api = inject(ReviewApi);

  readonly recordId = input<string | null>(null);
  readonly open = model(false);
  readonly confirmedRecord = output<RecordDetailDto>();

  protected readonly record = rxResource({
    params: () => (this.open() ? this.recordId() : null),
    stream: ({ params: id }) => (id ? this.api.get(id) : of(null)),
  });
  /** The target catalog, loaded once; it holds each target's JSON Schema. */
  private readonly catalog = rxResource({ stream: () => this.api.catalog() });
  protected readonly schema = computed(() => {
    const targetKey = this.record.value()?.targetKey;
    return this.catalog.value()?.find((entry) => entry.targetKey === targetKey)
      ?.jsonSchema as SchemaShape | undefined;
  });
  protected readonly saving = signal(false);
  protected readonly error = signal('');
  protected readonly statusView = RECORD_STATUS_VIEW;

  protected readonly canConfirm = computed(() => {
    const record = this.record.value();
    return !!record && CONFIRMABLE_STATUSES.includes(record.status);
  });
  protected readonly categoryLabel = computed(() => {
    const category = this.record.value()?.category;
    return category
      ? (CATEGORY_LABELS[category] ?? humanize(category))
      : 'Uncategorized';
  });

  protected fileUrl(record: RecordDetailDto): string {
    return this.api.originalFileUrl(record.uploadId);
  }

  protected flagLabel(flag: string): string {
    return humanize(flag);
  }

  protected async confirm(): Promise<void> {
    const record = this.record.value();
    if (!record) return;
    this.saving.set(true);
    this.error.set('');
    try {
      const confirmed = await firstValueFrom(this.api.confirm(record.id));
      this.confirmedRecord.emit(confirmed);
      this.open.set(false);
    } catch (error) {
      const body =
        error instanceof HttpErrorResponse
          ? (error.error as { message?: string } | null)
          : null;
      this.error.set(
        body?.message ?? 'The record could not be confirmed. Try again.',
      );
    } finally {
      this.saving.set(false);
    }
  }

  protected onClosed(): void {
    this.error.set('');
  }
}
