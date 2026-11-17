import {
  ChangeDetectionStrategy,
  Component,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import {
  ID_DOCUMENT_STATUS_LABELS,
  type IdDocumentSeriesDto,
  type IdDocumentStatus,
  type PersonDto,
} from '@life-island/contracts';
import {
  UiAlert,
  UiBadge,
  UiButton,
  UiCard,
  UiIcon,
  type UiTone,
} from '@life-island/design-system';
import { dateText, errorText } from '@life-island/records-ui';
import { PeopleApi } from '../api/people-api';
import { masked, typeLabel } from './labels';

const STATUS_TONES: Record<IdDocumentStatus, UiTone> = {
  current: 'success',
  expired: 'danger',
  superseded: 'neutral',
  lost: 'warning',
  stolen: 'warning',
  withdrawn: 'warning',
};

/**
 * One kind of ID document of a person (identity card, passport...), version
 * by version: its dates, what it prints, and a way to mark one lost, stolen
 * or withdrawn.
 */
@Component({
  selector: 'people-series-card',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [UiAlert, UiBadge, UiButton, UiCard, UiIcon],
  templateUrl: './people-series-card.html',
  styleUrl: './people-series-card.css',
})
export class PeopleSeriesCard {
  private readonly api = inject(PeopleApi);

  readonly series = input.required<IdDocumentSeriesDto>();
  /** The person's expiry warnings, shown on the version they are about. */
  readonly alerts = input.required<PersonDto['alerts']>();
  /** Document numbers shown in full. */
  readonly revealed = input(false);
  /** A version changed: the page loads everyone again. */
  readonly changed = output<void>();

  protected readonly busy = signal<string | null>(null);
  protected readonly error = signal<string | null>(null);

  protected readonly statusLabels = ID_DOCUMENT_STATUS_LABELS;
  protected readonly statusTones = STATUS_TONES;
  protected readonly typeLabel = typeLabel;
  protected readonly dateText = dateText;

  /** The warning of the document itself (a licence category warns apart). */
  protected alertOf(uploadId: string) {
    return (
      this.alerts().find(
        (a) => a.uploadId === uploadId && a.category === null,
      ) ?? null
    );
  }

  /** A document number, hidden but its end until you ask. */
  protected secret(value: string | null): string | null {
    return masked(value, this.revealed());
  }

  protected previewUrl(uploadId: string): string {
    return this.api.previewUrl(uploadId);
  }

  protected mark(uploadId: string, value: string): void {
    const status =
      value === 'lost' || value === 'stolen' || value === 'withdrawn'
        ? value
        : null;
    this.busy.set(uploadId);
    this.error.set(null);
    this.api.mark(uploadId, { status }).subscribe({
      next: () => {
        this.busy.set(null);
        this.changed.emit();
      },
      error: (error: unknown) => {
        this.busy.set(null);
        this.error.set(
          errorText(
            error,
            'That did not work. Please try again.',
            'svc-people',
          ),
        );
      },
    });
  }
}
