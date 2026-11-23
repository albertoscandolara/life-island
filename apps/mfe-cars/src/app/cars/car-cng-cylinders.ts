import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
} from '@angular/core';
import type { CarCngDto } from '@life-island/contracts';
import { dateText } from '@life-island/records-ui';
import { CarsApi } from '../api/cars-api';
import { italianNumber } from './labels';

/** "07/2027" from 2027-07: how the label prints a month. */
const monthText = (month: string | null) =>
  month ? `${month.slice(5, 7)}/${month.slice(0, 4)}` : '–';

/**
 * The CNG (metano) cylinders of a car, inside its CNG document card: the
 * cylinders the latest label lists, and the requalifications at which they
 * were exchanged. The card itself (when, the rules, every label) is the same
 * as every car document's.
 */
@Component({
  selector: 'cars-cng-cylinders',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [],
  styleUrl: './insights.css',
  template: `
    @let c = cng();
    @if (c.cylinders.length) {
      <h3 class="sub">On the car</h3>
      @if (c.endOfLife) {
        <p class="muted small">End of life: {{ dateText(c.endOfLife) }}</p>
      }
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
                    cylinder.litres === null ? '–' : num(cylinder.litres, 0, 1)
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
    @if (exchanged().length) {
      <p class="muted small">
        Cylinders exchanged at the requalification of
        @for (h of exchanged(); track h.uploadId) {
          <a
            class="li-link"
            [href]="previewUrl(h.uploadId)"
            target="_blank"
            rel="noopener"
            >{{ monthText(h.month) }}</a
          >{{ $last ? '.' : ',' }}
        }
      </p>
    }
  `,
  styles: `
    :host {
      display: block;
    }
  `,
})
export class CarCngCylinders {
  private readonly api = inject(CarsApi);

  readonly cng = input.required<CarCngDto>();

  /** The requalifications at which the cylinders were exchanged, newest first. */
  protected readonly exchanged = computed(() =>
    this.cng().history.filter((h) => h.replaced),
  );

  protected readonly num = italianNumber;
  protected readonly dateText = dateText;
  protected readonly monthText = monthText;

  protected previewUrl(uploadId: string): string {
    return this.api.previewUrl(uploadId);
  }
}
