import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import {
  CAR_ARCHIVE_ACTION_LABELS,
  CAR_DOCUMENT_GUIDES,
  CAR_DOCUMENT_ROLE_LABELS,
  CAR_DOCUMENT_STATUS_LABELS,
  CAR_DOCUMENT_TYPE_LABELS,
  proofUploadUrl,
  type CarArchiveAction,
  type CarDocumentCardType,
  type CarDocumentPartDto,
  type CarDocumentSeriesDto,
  type CarDocumentStatus,
  type CarDocumentVersionDto,
  type RenewalDto,
  type RenewalLevel,
  type VehicleStatus,
} from '@life-island/contracts';
import {
  UiAlert,
  UiBadge,
  UiButton,
  UiCard,
  UiIcon,
  type UiIconName,
  type UiTone,
} from '@life-island/design-system';
import { dateText, daysText, errorText, euro } from '@life-island/records-ui';
import { DOCUMENTS_APP_URL } from '@life-island/settings-ui';
import type { Observable } from 'rxjs';
import { CarsApi } from '../api/cars-api';
import { factText } from './labels';

/** Each document's icon: the one sign it carries everywhere in Cars. */
export const CAR_DOCUMENT_ICONS: Record<CarDocumentCardType, UiIconName> = {
  CAR_INSURANCE: 'shield',
  ROAD_TAX: 'receipt',
  VEHICLE_INSPECTION: 'clipboard',
  CNG_CYLINDER_INSPECTION: 'flame',
  VEHICLE_REGISTRATION: 'car',
};

const STATUS_TONES: Record<CarDocumentStatus, UiTone> = {
  current: 'success',
  expired: 'danger',
  superseded: 'neutral',
  cancelled: 'warning',
};

const LEVELS: Record<RenewalLevel, { tone: UiTone; label: string }> = {
  ok: { tone: 'success', label: 'In order' },
  expiring: { tone: 'warning', label: 'Due soon' },
  grace: { tone: 'warning', label: 'Grace period' },
  expired: { tone: 'danger', label: 'Expired' },
  missing: { tone: 'neutral', label: 'None on file' },
  suspended: { tone: 'danger', label: 'Suspended' },
};

const WHERE_TONES: Record<CarArchiveAction, UiTone> = {
  in_car: 'info',
  keep: 'neutral',
  discard: 'neutral',
};

/**
 * One car document, the same shape for every kind (insurance, bollo,
 * revisione, CNG cylinders, carta di circolazione): its next step and
 * date on top, then what the latest one says, then the rules (how often,
 * where to keep it and for how long), then every version with the buttons to
 * attach, detach or cancel one. Content projected inside (the CNG cylinders)
 * goes after what the latest one says.
 */
@Component({
  selector: 'cars-doc-card',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [UiAlert, UiBadge, UiButton, UiCard, UiIcon],
  templateUrl: './car-doc-card.html',
  styleUrls: ['./cars-bits.css', './car-doc-card.css'],
  host: { '[attr.id]': '"doc-" + type()' },
})
export class CarDocCard {
  private readonly api = inject(CarsApi);
  private readonly documentsUrl = inject(DOCUMENTS_APP_URL);

  readonly type = input.required<CarDocumentCardType>();
  /** Its versions, newest first; null when none is on file. */
  readonly series = input<CarDocumentSeriesDto | null>(null);
  /** Where its renewal stands; null when it has none (a carta di circolazione). */
  readonly renewal = input<RenewalDto | null>(null);
  readonly vehicleStatus = input.required<VehicleStatus>();
  /** The car's name, for the upload's title. */
  readonly vehicleName = input.required<string>();
  /** Whether "The rules" opens a topic of the Cars guide. */
  readonly guideTopic = input<string | null>(null);
  /** A version changed: the page loads the car again. */
  readonly changed = output<void>();
  readonly showGuide = output<string>();

  protected readonly busy = signal<string | null>(null);
  protected readonly error = signal<string | null>(null);

  protected readonly guide = computed(() => CAR_DOCUMENT_GUIDES[this.type()]);
  protected readonly icon = computed(() => CAR_DOCUMENT_ICONS[this.type()]);
  protected readonly title = computed(
    () => CAR_DOCUMENT_TYPE_LABELS[this.type()],
  );
  protected readonly versions = computed(() => this.series()?.versions ?? []);
  /** The latest version that counts (a cancelled policy never does). */
  protected readonly latest = computed(
    () =>
      this.versions().find((v) => v.status !== 'cancelled') ??
      this.versions()[0] ??
      null,
  );

  /** The next step: a date to act by, or what stands in for one. */
  protected readonly next = computed(() => {
    const renewal = this.renewal();
    const latest = this.latest();
    const guide = this.guide();
    if (renewal) {
      const level = LEVELS[renewal.level];
      if (renewal.dueDate)
        return {
          heading: `${guide.dueVerb} ${dateText(renewal.dueDate)}`,
          detail: [daysText(renewal.daysLeft), renewal.basis]
            .filter(Boolean)
            .join(' · '),
          ...level,
          level: renewal.level,
        };
      if (renewal.level === 'missing')
        return {
          heading: 'None on file',
          detail: renewal.basis,
          ...level,
          level: renewal.level,
        };
      return {
        heading: renewal.level === 'suspended' ? 'Suspended' : renewal.basis,
        detail: renewal.level === 'suspended' ? renewal.basis : '',
        ...level,
        level: renewal.level,
      };
    }
    if (latest)
      return {
        heading: 'Nothing to renew',
        detail: guide.renewal,
        tone: STATUS_TONES[latest.status],
        label: CAR_DOCUMENT_STATUS_LABELS[latest.status],
        level: 'ok' as RenewalLevel,
      };
    return {
      heading: 'None on file',
      detail: `Load it to see ${this.title().toLowerCase()} here.`,
      ...LEVELS.missing,
      level: 'missing' as RenewalLevel,
    };
  });

  /** The car is in use and this needs you: the button turns primary. */
  protected readonly urgent = computed(
    () => this.next().level !== 'ok' && this.vehicleStatus() !== 'sold',
  );

  protected readonly uploadUrl = computed(() =>
    proofUploadUrl(this.documentsUrl, {
      module: 'cars',
      title: `${this.title()} · ${this.vehicleName()}`,
      proof: this.guide().proof,
    }),
  );

  protected readonly where = computed(() => {
    const action = this.guide().where;
    return {
      label: CAR_ARCHIVE_ACTION_LABELS[action].en,
      tone: WHERE_TONES[action],
    };
  });

  protected readonly statusLabels = CAR_DOCUMENT_STATUS_LABELS;
  protected readonly roleLabels = CAR_DOCUMENT_ROLE_LABELS;
  protected readonly statusTones = STATUS_TONES;
  protected readonly dateText = dateText;
  protected readonly euro = euro;
  protected readonly factText = factText;

  /** The documents of the other versions, to put in this one. */
  protected attachable(version: CarDocumentVersionDto): CarDocumentPartDto[] {
    return this.versions()
      .filter((v) => v.uploadId !== version.uploadId)
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
