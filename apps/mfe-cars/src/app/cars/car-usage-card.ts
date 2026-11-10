import { DatePipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
} from '@angular/core';
import type { CarUsageDto } from '@life-island/contracts';
import { UiAlert, UiBadge, UiCard } from '@life-island/design-system';
import { italianNumber } from './labels';

/**
 * Km and fuel of one car: the km a year and today's estimate from every km
 * reading its documents print (one lower than an earlier one is flagged), the
 * real consumption from the fuel receipts against the card's (V.8), and what
 * a km costs.
 */
@Component({
  selector: 'cars-usage-card',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DatePipe, UiAlert, UiBadge, UiCard],
  styleUrl: './insights.css',
  template: `
    <ui-card heading="Km and fuel">
      @let u = usage();
      @if (!u.readings.length && !u.fills.length) {
        <p class="muted">
          Nothing yet: km are read from revisione reports, service invoices and
          fuel receipts that print them; litres from fuel receipts.
        </p>
      } @else {
        <dl class="stats">
          <div class="stat">
            <dt>Km a year</dt>
            <dd>{{ u.kmPerYear === null ? '—' : num(u.kmPerYear, 0, 0) }}</dd>
          </div>
          <div class="stat">
            <dt>Odometer today</dt>
            <dd>
              {{ u.estimatedKm === null ? '—' : num(u.estimatedKm, 0, 0) }}
              @if (u.estimatedKm !== null) {
                <small>km{{ u.kmPerYear !== null ? ', estimated' : '' }}</small>
              }
            </dd>
          </div>
          <div class="stat">
            <dt>Consumption</dt>
            <dd>
              {{
                u.litresPer100Km === null ? '—' : num(u.litresPer100Km, 1, 1)
              }}
              @if (u.litresPer100Km !== null) {
                <small>l/100 km</small>
              }
            </dd>
            @if (u.officialLitresPer100Km !== null) {
              <small class="muted">
                Card (V.8): {{ num(u.officialLitresPer100Km, 1, 1) }}
                @if (overOfficial(); as over) {
                  ·
                  <span [class.up]="over > 0" [class.down]="over < 0"
                    >{{ over > 0 ? '+' : '' }}{{ num(over, 0, 0) }}%</span
                  >
                }
              </small>
            }
          </div>
          <div class="stat">
            <dt>Fuel price</dt>
            <dd>
              {{
                u.pricePerLitre === null
                  ? '—'
                  : '€ ' + num(u.pricePerLitre, 3, 3)
              }}
              @if (u.pricePerLitre !== null) {
                <small>/l</small>
              }
            </dd>
          </div>
          <div class="stat">
            <dt>Fuel per km</dt>
            <dd>
              {{
                u.fuelCostPerKm === null
                  ? '—'
                  : '€ ' + num(u.fuelCostPerKm, 3, 3)
              }}
            </dd>
          </div>
          <div class="stat">
            <dt>Cost per km</dt>
            <dd>
              {{ u.costPerKm === null ? '—' : '€ ' + num(u.costPerKm, 2, 2) }}
            </dd>
            <small class="muted"
              >€ {{ num(u.costLast12Months, 0, 0) }} in the last 12
              months</small
            >
          </div>
        </dl>

        @if (anomalies().length) {
          <ui-alert tone="danger">
            {{
              anomalies().length === 1
                ? 'One reading is'
                : anomalies().length + ' readings are'
            }}
            lower than an earlier one: check the document for a misread. If it
            is right, the odometer was wound back.
          </ui-alert>
        }

        @if (u.readings.length) {
          <h3 class="sub">Odometer readings</h3>
          <div class="table-wrap">
            <table class="table">
              <thead>
                <tr>
                  <th scope="col">Date</th>
                  <th scope="col" class="num">Km</th>
                  <th scope="col">Document</th>
                </tr>
              </thead>
              <tbody>
                @for (r of readingsNewestFirst(); track r.uploadId + r.date) {
                  <tr [class.row--anomaly]="r.anomaly">
                    <th scope="row" class="nowrap">
                      {{ r.date | date: 'd MMM y' }}
                    </th>
                    <td class="num">{{ num(r.km, 0, 0) }}</td>
                    <td>
                      {{ r.title }}
                      @if (r.anomaly) {
                        <ui-badge tone="danger">Lower than before</ui-badge>
                      }
                    </td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        }

        @if (u.fills.length) {
          <h3 class="sub">Fuel receipts</h3>
          <div class="table-wrap">
            <table class="table">
              <thead>
                <tr>
                  <th scope="col">Date</th>
                  <th scope="col" class="num">Litres</th>
                  <th scope="col" class="num">€/l</th>
                  <th scope="col" class="num">Km</th>
                  <th scope="col" class="num">l/100 km</th>
                </tr>
              </thead>
              <tbody>
                @for (f of u.fills.slice(0, 12); track f.uploadId) {
                  <tr>
                    <th scope="row">{{ f.date | date: 'd MMM y' }}</th>
                    <td class="num">{{ num(f.litres, 2, 2) }}</td>
                    <td class="num">{{ num(f.pricePerLitre, 3, 3) }}</td>
                    <td class="num">
                      {{
                        f.odometerKm === null ? '—' : num(f.odometerKm, 0, 0)
                      }}
                    </td>
                    <td class="num">
                      {{
                        f.litresPer100Km === null
                          ? '—'
                          : num(f.litresPer100Km, 1, 1)
                      }}
                    </td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
          <p class="muted small">
            The consumption of a fill is its litres over the km since the
            previous one, so it is right when you fill the tank up each time.
          </p>
        }
      }
    </ui-card>
  `,
})
export class CarUsageCard {
  readonly usage = input.required<CarUsageDto>();

  protected readonly num = italianNumber;

  protected readonly anomalies = computed(() =>
    this.usage().readings.filter((r) => r.anomaly),
  );

  protected readonly readingsNewestFirst = computed(() =>
    [...this.usage().readings].reverse().slice(0, 12),
  );

  /** How far the real consumption is from the card's, in percent. */
  protected readonly overOfficial = computed(() => {
    const { litresPer100Km: real, officialLitresPer100Km: official } =
      this.usage();
    if (real === null || !official) return null;
    const over = ((real - official) / official) * 100;
    return Math.abs(over) < 1 ? null : over;
  });
}
