import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  output,
} from '@angular/core';
import {
  CNG_APPROVAL_LABELS,
  proofUploadUrl,
  type CarCngDto,
  type RenewalLevel,
  type VehicleStatus,
} from '@life-island/contracts';
import {
  UiBadge,
  UiButton,
  UiCard,
  UiIcon,
  type UiTone,
} from '@life-island/design-system';
import { daysText, dateText } from '@life-island/records-ui';
import { DOCUMENTS_APP_URL } from '@life-island/settings-ui';
import { CarsApi } from '../api/cars-api';
import { italianNumber } from './labels';

const LEVEL: Record<RenewalLevel, { tone: UiTone; label: string }> = {
  ok: { tone: 'success', label: 'In order' },
  expiring: { tone: 'warning', label: 'Due soon' },
  grace: { tone: 'warning', label: 'Due soon' },
  expired: { tone: 'danger', label: 'Expired' },
  missing: { tone: 'neutral', label: 'No label on file' },
  suspended: { tone: 'danger', label: 'Suspended' },
};

/** "07/2027" from 2027-07: how the label prints a month. */
const monthText = (month: string | null) =>
  month ? `${month.slice(5, 7)}/${month.slice(0, 4)}` : '–';

/**
 * The CNG (metano) cylinders of a car: when they have to be requalified, the
 * cylinders the latest label lists, and every requalification on file. Shown
 * for every car whose fuel is CNG, and for any car with a cylinder label.
 */
@Component({
  selector: 'cars-cng-card',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [UiBadge, UiButton, UiCard, UiIcon],
  styleUrl: './insights.css',
  template: `
    @let c = cng();
    <ui-card heading="CNG cylinders">
      <button
        uiCardActions
        uiButton
        variant="ghost"
        size="sm"
        type="button"
        (click)="showGuide.emit()"
      >
        <ui-icon name="book" [size]="14" /> The rules
      </button>
      <div class="item">
        <div class="item__head">
          <h3 class="item__title">
            @if (c.dueDate) {
              Requalify by {{ dateText(c.dueDate) }}
            } @else {
              Requalification date unknown
            }
          </h3>
          <ui-badge [tone]="level().tone">{{ level().label }}</ui-badge>
        </div>
        <p class="muted">
          @if (c.dueDate && c.daysLeft !== null) {
            {{ daysText(c.daysLeft) }} ·
          }
          {{ c.basis }}
        </p>
        @if (status() === 'active' && c.level !== 'ok') {
          <p>
            @if (c.level === 'expired') {
              Do not use the car, not even on petrol, until a recognised
              workshop has requalified or exchanged the cylinders.
            } @else if (c.level === 'missing') {
              Photograph the label the workshop applied on the car (usually in
              the engine bay) and load it.
            } @else {
              Book a workshop recognised by the Fondo Bombole Metano: it checks
              or exchanges the cylinders and applies a new label.
            }
          </p>
        }
        <div class="actions">
          <a
            uiButton
            size="sm"
            [variant]="c.level === 'ok' ? 'secondary' : 'primary'"
            [href]="uploadUrl()"
          >
            <ui-icon name="upload" [size]="14" />
            {{ c.history.length ? 'Load the new label' : 'Load the label' }}
          </a>
        </div>
      </div>

      @if (c.cylinders.length) {
        <h3 class="sub">On the car</h3>
        <dl class="deadlines facts">
          @if (c.approval) {
            <dt>Approval</dt>
            <dd>{{ approvalLabels[c.approval] }}</dd>
          }
          @if (c.cylinderType) {
            <dt>Type</dt>
            <dd>{{ c.cylinderType }}</dd>
          }
          @if (c.totalLitres !== null) {
            <dt>Total</dt>
            <dd>{{ num(c.totalLitres, 0, 1) }} l</dd>
          }
          @if (c.endOfLife) {
            <dt>End of life</dt>
            <dd>{{ dateText(c.endOfLife) }}</dd>
          }
        </dl>
        <div class="table-wrap">
          <table class="table">
            <thead>
              <tr>
                <th scope="col" class="num">Litres</th>
                <th scope="col">Maker</th>
                <th scope="col">Serial number</th>
                <th scope="col">Due</th>
              </tr>
            </thead>
            <tbody>
              @for (cylinder of c.cylinders; track $index) {
                <tr>
                  <td class="num">
                    {{
                      cylinder.litres === null
                        ? '–'
                        : num(cylinder.litres, 0, 1)
                    }}
                  </td>
                  <td>{{ cylinder.make ?? '–' }}</td>
                  <td class="nowrap">{{ cylinder.serialNumber ?? '–' }}</td>
                  <td>{{ monthText(cylinder.dueMonth) }}</td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      }

      @if (c.history.length) {
        <h3 class="sub">Requalifications</h3>
        <ul class="items">
          @for (h of c.history; track h.uploadId; let first = $first) {
            <li class="item">
              <div class="item__head">
                <a
                  class="li-link item__title"
                  [href]="previewUrl(h.uploadId)"
                  target="_blank"
                  rel="noopener"
                  >{{ monthText(h.month) }}</a
                >
                @if (h.replaced) {
                  <ui-badge tone="info">Cylinders exchanged</ui-badge>
                } @else if (first) {
                  <ui-badge tone="neutral">Latest</ui-badge>
                }
              </div>
              <p class="muted">
                {{ h.workshop ?? 'Workshop not read' }}
                @if (h.labelNumber) {
                  · label {{ h.labelNumber }}
                }
                · {{ h.cylinders.length }}
                {{ h.cylinders.length === 1 ? 'cylinder' : 'cylinders' }}
              </p>
            </li>
          }
        </ul>
      }
      <p class="muted small">
        Not in the car: the label stays fixed on it. Keep a copy of the latest
        one at home; older labels can go.
      </p>
    </ui-card>
  `,
  styles: `
    .facts {
      margin-bottom: var(--space-3);
    }

    .actions {
      display: flex;
      flex-wrap: wrap;
      gap: var(--space-2);
    }
  `,
})
export class CarCngCard {
  private readonly api = inject(CarsApi);
  private readonly documentsUrl = inject(DOCUMENTS_APP_URL);

  readonly cng = input.required<CarCngDto>();
  readonly status = input.required<VehicleStatus>();
  /** The car's name, for the upload's "for". */
  readonly vehicleName = input.required<string>();
  /** Opens the Cars guide on the cylinders' rules. */
  readonly showGuide = output<void>();

  protected readonly level = computed(() => LEVEL[this.cng().level]);
  protected readonly uploadUrl = computed(() =>
    proofUploadUrl(this.documentsUrl, {
      module: 'cars',
      title: `CNG cylinders · ${this.vehicleName()}`,
      proof: 'the new CNG cylinder label',
    }),
  );

  protected readonly approvalLabels = CNG_APPROVAL_LABELS;
  protected readonly num = italianNumber;
  protected readonly dateText = dateText;
  protected readonly daysText = daysText;
  protected readonly monthText = monthText;

  protected previewUrl(uploadId: string): string {
    return this.api.previewUrl(uploadId);
  }
}
