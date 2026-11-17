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
  CAR_DOCUMENT_STATUS_LABELS,
  type CarDocumentPartDto,
  type CarDocumentSeriesDto,
  type CarDocumentStatus,
  type CarDocumentVersionDto,
  type RenewalAlertDto,
} from '@life-island/contracts';
import {
  UiAlert,
  UiBadge,
  UiButton,
  UiCard,
  UiIcon,
  type UiTone,
} from '@life-island/design-system';
import { dateText, errorText, euro } from '@life-island/records-ui';
import type { Observable } from 'rxjs';
import { CarsApi } from '../api/cars-api';
import { renewalText, typeLabel } from './labels';

const STATUS_TONES: Record<CarDocumentStatus, UiTone> = {
  current: 'success',
  expired: 'danger',
  superseded: 'neutral',
  cancelled: 'warning',
};

/**
 * One kind of document of a car (insurance, road tax, revisione...), version
 * by version: its dates and amount, the documents of each record, and the
 * buttons to attach, detach or cancel one.
 */
@Component({
  selector: 'cars-series-card',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [UiAlert, UiBadge, UiButton, UiCard, UiIcon],
  templateUrl: './car-series-card.html',
  styleUrls: ['./cars-bits.css', './car-series-card.css'],
})
export class CarSeriesCard {
  private readonly api = inject(CarsApi);

  readonly series = input.required<CarDocumentSeriesDto>();
  /** The car's renewal warnings, shown on the version they are about. */
  readonly alerts = input.required<RenewalAlertDto[]>();
  /** A version changed: the page loads the car again. */
  readonly changed = output<void>();

  protected readonly busy = signal<string | null>(null);
  protected readonly error = signal<string | null>(null);

  protected readonly statusLabels = CAR_DOCUMENT_STATUS_LABELS;
  protected readonly roleLabels = CAR_DOCUMENT_ROLE_LABELS;
  protected readonly statusTones = STATUS_TONES;
  protected readonly typeLabel = typeLabel;
  protected readonly renewalText = renewalText;
  protected readonly dateText = dateText;
  protected readonly euro = euro;

  protected alertOf(uploadId: string): RenewalAlertDto | null {
    return this.alerts().find((a) => a.uploadId === uploadId) ?? null;
  }

  /** The documents of the other versions of the series, to put in this one. */
  protected attachable(version: CarDocumentVersionDto): CarDocumentPartDto[] {
    return this.series()
      .versions.filter((v) => v.uploadId !== version.uploadId)
      .flatMap((v) => v.documents);
  }

  protected previewUrl(uploadId: string): string {
    return this.api.previewUrl(uploadId);
  }

  protected mark(uploadId: string, value: string): void {
    const status = value === 'cancelled' ? value : null;
    this.run(uploadId, () => this.api.mark(uploadId, { status }));
  }

  protected attach(select: HTMLSelectElement, target: string): void {
    const uploadId = select.value;
    select.value = '';
    if (!uploadId) return;
    this.run(uploadId, () => this.api.group(uploadId, { attachTo: target }));
  }

  /** Takes a document out of its record, into a version of its own. */
  protected detach(uploadId: string): void {
    this.run(uploadId, () => this.api.group(uploadId, { attachTo: null }));
  }

  private run(key: string, call: () => Observable<void>): void {
    this.busy.set(key);
    this.error.set(null);
    call().subscribe({
      next: () => {
        this.busy.set(null);
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
