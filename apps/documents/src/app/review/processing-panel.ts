import { DatePipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
} from '@angular/core';
import { rxResource } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import type {
  ExtractedField,
  FieldStatus,
  UploadDto,
} from '@life-island/contracts';
import { PARSE_STEPS } from '@life-island/contracts/constants';
import {
  UiAlert,
  UiBadge,
  UiStatusDot,
  type UiTone,
} from '@life-island/design-system';
import { of } from 'rxjs';
import { IngestionApi } from '../api/ingestion-api';
import { PROCESSING_VIEW, STEP_LABELS } from './record-status';

const FIELD_STATUS_VIEW: Record<FieldStatus, { label: string; tone: UiTone }> =
  {
    found: { label: 'Found', tone: 'success' },
    missing: { label: 'Not in document', tone: 'neutral' },
    illegible: { label: 'Illegible', tone: 'warning' },
    ambiguous: { label: 'Ambiguous', tone: 'warning' },
    conflicting: { label: 'Conflicting', tone: 'danger' },
    invalid: { label: 'Invalid format', tone: 'danger' },
  };

/** Why a document is not fully processed yet, in plain words. */
export function pendingReason(upload: UploadDto): string | null {
  switch (upload.processingState) {
    case 'PAUSED_QUOTA':
      return 'Paused because the AI usage quota is exhausted. It continues automatically when quota is available again.';
    case 'PAUSED_RATE_LIMIT':
      return 'Paused because the AI provider rate-limited the service. It continues automatically after the retry time.';
    case 'PARTIAL':
      return `Interrupted by an error and will be retried${upload.lastError ? `: ${upload.lastError}` : '.'}`;
    case 'PENDING':
      return 'Waiting for the next processing run.';
    case 'PROCESSING':
      return 'Being processed now.';
    case 'FAILED':
      return `Processing failed${upload.lastError ? `: ${upload.lastError}` : '.'}`;
    default:
      return null;
  }
}

export function formatFieldValue(field: ExtractedField): string {
  if (field.value === null) return '–';
  if (typeof field.value === 'boolean') return field.value ? 'Yes' : 'No';
  if (field.type === 'amount' && typeof field.value === 'number')
    return field.value.toFixed(2);
  return `${field.value}${field.unit ? ` ${field.unit}` : ''}`;
}

/**
 * What the AI processing produced for one document, complete or partial:
 * which steps are done, the analysis, assigned categories, template fields
 * and category suggestions. A document still in progress says so and why.
 */
@Component({
  selector: 'app-processing-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DatePipe, RouterLink, UiAlert, UiBadge, UiStatusDot],
  templateUrl: './processing-panel.html',
  styleUrl: './processing-panel.css',
})
export class ProcessingPanel {
  private readonly api = inject(IngestionApi);
  readonly uploadId = input<string | null>(null);

  protected readonly upload = rxResource({
    params: () => this.uploadId(),
    stream: ({ params: id }) => (id ? this.api.get(id) : of(null)),
  });
  private readonly categories = rxResource({
    stream: () => this.api.categories(),
  });
  protected readonly suggestions = rxResource({
    params: () => this.uploadId(),
    stream: ({ params: id }) =>
      id ? this.api.suggestions({ uploadId: id }) : of([]),
  });

  protected readonly view = PROCESSING_VIEW;
  protected readonly stepLabels = STEP_LABELS;
  protected readonly steps = PARSE_STEPS;
  protected readonly fieldStatus = FIELD_STATUS_VIEW;
  protected readonly reason = computed(() => {
    const upload = this.upload.value();
    return upload ? pendingReason(upload) : null;
  });
  protected readonly fields = computed(() =>
    Object.entries(this.upload.value()?.extractedFields?.fields ?? {}).map(
      ([key, field]) => ({ key, ...field, display: formatFieldValue(field) }),
    ),
  );

  protected categoryTitle(id: string): string {
    return (
      this.categories.value()?.find((category) => category.id === id)?.title ??
      id
    );
  }

  protected stepState(upload: UploadDto, step: (typeof PARSE_STEPS)[number]) {
    if (upload.completedSteps.includes(step)) return 'done';
    if (upload.currentStep === step) return 'current';
    return 'todo';
  }
}
