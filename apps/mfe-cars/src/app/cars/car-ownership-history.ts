import {
  ChangeDetectionStrategy,
  Component,
  inject,
  input,
  output,
} from '@angular/core';
import {
  OWNERSHIP_DOCUMENT_KIND_LABELS,
  type CarOwnershipDto,
  type CarOwnershipEventDto,
} from '@life-island/contracts';
import { UiAlert, UiButton, UiIcon } from '@life-island/design-system';
import { dateText } from '@life-island/records-ui';
import { CarsApi } from '../api/cars-api';

/** What a step of the history is, in a few words. */
export function ownershipEventText(event: CarOwnershipEventDto): string {
  if (event.kind === 'registered') return 'First registration';
  return OWNERSHIP_DOCUMENT_KIND_LABELS[event.kind];
}

/**
 * Who owns a car, inside its ownership document card: a lien to clear, a
 * libretto that still names someone else (with the step to take), and every
 * change of owner on file from the first registration. The card itself (the
 * latest certificate, the rules, every version) is the same as every car
 * document's.
 */
@Component({
  selector: 'cars-ownership-history',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [UiAlert, UiButton, UiIcon],
  styleUrl: './insights.css',
  template: `
    @let o = ownership();
    @if (o.liens) {
      <ui-alert tone="danger" class="block">
        A lien is recorded on the car: {{ o.liens }}. Have it cancelled at the
        PRA before you sell: a buyer would take it with the car.
      </ui-alert>
    }
    @if (o.holderDiffers) {
      <ui-alert tone="warning" class="block">
        The libretto still names {{ o.holderDiffers }}, the certificate
        {{ o.owners.join(', ') }}. After a change of owner the carta di
        circolazione follows: load the new one.
        <button
          uiButton
          variant="secondary"
          size="sm"
          type="button"
          class="block"
          (click)="open.emit('doc-VEHICLE_REGISTRATION')"
        >
          <ui-icon name="car" [size]="14" /> Go to the libretto
        </button>
      </ui-alert>
    }
    @if (o.events.length) {
      <h3 class="sub">History of owners</h3>
      <div class="table-wrap">
        <table class="table">
          <thead>
            <tr>
              <th scope="col">Date</th>
              <th scope="col">What</th>
              <th scope="col">Owner</th>
            </tr>
          </thead>
          <tbody>
            @for (event of o.events; track $index) {
              <tr>
                <td class="nowrap">
                  {{ event.date ? dateText(event.date) : '–' }}
                </td>
                <td>
                  @if (event.uploadId) {
                    <a
                      class="li-link"
                      [href]="previewUrl(event.uploadId)"
                      target="_blank"
                      rel="noopener"
                      >{{ text(event) }}</a
                    >
                  } @else {
                    {{ text(event) }}
                  }
                </td>
                <td>
                  @if (event.seller) {
                    <span class="muted">{{ event.seller }} →</span>
                  }
                  {{ event.owners.join(', ') || '–' }}
                </td>
              </tr>
            }
          </tbody>
        </table>
      </div>
      @if (o.previousOwners !== null) {
        <p class="muted small">
          {{
            o.previousOwners === 0
              ? 'No owner before the current one.'
              : o.previousOwners === 1
                ? '1 owner before the current one, as the certificate counts them.'
                : o.previousOwners +
                  ' owners before the current one, as the certificate counts them.'
          }}
        </p>
      }
    }
  `,
  styles: `
    :host {
      display: block;
    }
    .block {
      display: block;
      margin-block: var(--space-2);
    }
  `,
})
export class CarOwnershipHistory {
  private readonly api = inject(CarsApi);

  readonly ownership = input.required<CarOwnershipDto>();
  /** Opens another card of the car, by its id. */
  readonly open = output<string>();

  protected readonly dateText = dateText;
  protected readonly text = ownershipEventText;

  protected previewUrl(uploadId: string): string {
    return this.api.previewUrl(uploadId);
  }
}
