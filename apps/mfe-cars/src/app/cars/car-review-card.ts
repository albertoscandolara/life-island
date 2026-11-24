import { DatePipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import {
  CAR_DOCUMENT_ROLE_LABELS,
  identifiesVehicle,
  REGISTRATION_CODE_MEANINGS,
  VEHICLE_FIELD_DEFINITIONS,
  type PendingCarReviewDto,
  type VehicleChangeSuggestion,
  type VehicleDto,
  type VehicleField,
} from '@life-island/contracts';
import {
  UiAlert,
  UiBadge,
  UiButton,
  UiIcon,
  type UiTone,
} from '@life-island/design-system';
import { errorText, LiReviewItem, LiToReview } from '@life-island/records-ui';
import type { Observable } from 'rxjs';
import { CarsApi } from '../api/cars-api';
import { typeLabel, valueText, vehicleName } from './labels';

/** The choices you make on one document waiting for review. */
interface Draft {
  /** The car it is about; 'new' adds one from it. */
  vehicleId: string;
  accept: Set<VehicleField>;
  /** The name of a new car. */
  label: string;
}

const SUGGESTION_LABELS: Record<VehicleChangeSuggestion, string> = {
  accept: 'Take it',
  keep_current: 'Keep yours',
  check: 'Check it',
};

const SUGGESTION_TONES: Record<VehicleChangeSuggestion, UiTone> = {
  accept: 'success',
  keep_current: 'neutral',
  check: 'warning',
};

const LABELS = new Map<string, string>(
  VEHICLE_FIELD_DEFINITIONS.map((d) => [d.field, d.label]),
);

/**
 * The car documents waiting for review: for each, which car it is about (or a
 * new one) and which printed values to take. Nothing changes a car until you
 * approve it here.
 */
@Component({
  selector: 'cars-review-card',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    DatePipe,
    LiReviewItem,
    LiToReview,
    UiAlert,
    UiBadge,
    UiButton,
    UiIcon,
  ],
  templateUrl: './car-review-card.html',
  styleUrls: ['./cars-bits.css', './car-review-card.css'],
})
export class CarReviewCard {
  private readonly api = inject(CarsApi);

  readonly reviews = input.required<PendingCarReviewDto[]>();
  readonly vehicles = input.required<VehicleDto[]>();
  /** A document was approved or rejected: the page loads the cars again. */
  readonly changed = output<void>();

  protected readonly busy = signal<string | null>(null);
  protected readonly error = signal<string | null>(null);
  private readonly drafts = signal<Record<string, Draft>>({});

  protected readonly roleLabels = CAR_DOCUMENT_ROLE_LABELS;
  protected readonly codeMeanings = REGISTRATION_CODE_MEANINGS;
  protected readonly suggestionLabels = SUGGESTION_LABELS;
  protected readonly suggestionTones = SUGGESTION_TONES;
  protected readonly typeLabel = typeLabel;
  protected readonly valueText = valueText;
  protected readonly vehicleName = vehicleName;

  protected label(field: VehicleField): string {
    return LABELS.get(field) ?? field;
  }

  protected previewUrl(uploadId: string): string {
    return this.api.previewUrl(uploadId);
  }

  protected draft(review: PendingCarReviewDto): Draft {
    return (
      this.drafts()[review.uploadId] ?? {
        vehicleId:
          review.vehicleId ??
          (identifiesVehicle(review)
            ? 'new'
            : (this.vehicles()[0]?.id ?? 'new')),
        accept: new Set(
          review.changes
            .filter((c) => c.suggestion === 'accept')
            .map((c) => c.field),
        ),
        label: '',
      }
    );
  }

  private update(review: PendingCarReviewDto, change: Partial<Draft>): void {
    this.drafts.update((all) => ({
      ...all,
      [review.uploadId]: { ...this.draft(review), ...change },
    }));
  }

  protected chooseVehicle(review: PendingCarReviewDto, vehicleId: string) {
    this.update(review, { vehicleId });
  }

  protected setDraftLabel(review: PendingCarReviewDto, label: string) {
    this.update(review, { label });
  }

  protected toggle(review: PendingCarReviewDto, field: VehicleField): void {
    const accept = new Set(this.draft(review).accept);
    if (accept.has(field)) accept.delete(field);
    else accept.add(field);
    this.update(review, { accept });
  }

  /** The changes against the car you picked (the server compared with its match). */
  protected changesFor(review: PendingCarReviewDto) {
    return this.draft(review).vehicleId === review.vehicleId
      ? review.changes
      : [];
  }

  /** Whether it names a car: a plate or a VIN. Without, it never makes a new car. */
  protected readable(review: PendingCarReviewDto): boolean {
    return identifiesVehicle(review);
  }

  protected isNewVehicle(review: PendingCarReviewDto): boolean {
    return this.draft(review).vehicleId === 'new';
  }

  protected approve(review: PendingCarReviewDto): void {
    const draft = this.draft(review);
    const isNew = draft.vehicleId === 'new';
    this.run(review.uploadId, () =>
      this.api.approve(review.uploadId, {
        vehicleId: isNew ? null : draft.vehicleId,
        accept: this.changesFor(review)
          .map((c) => c.field)
          .filter((field) => draft.accept.has(field)),
        ...(isNew ? { label: draft.label.trim() || null } : {}),
      }),
    );
  }

  protected reject(review: PendingCarReviewDto): void {
    this.run(review.uploadId, () => this.api.reject(review.uploadId));
  }

  private run(key: string, call: () => Observable<void>): void {
    this.busy.set(key);
    this.error.set(null);
    call().subscribe({
      next: () => {
        this.busy.set(null);
        this.drafts.update((all) => {
          const rest = { ...all };
          delete rest[key];
          return rest;
        });
        this.changed.emit();
      },
      error: (error: unknown) => {
        this.busy.set(null);
        this.error.set(
          errorText(error, 'That did not work. Please try again.', 'svc-cars'),
        );
      },
    });
  }
}
