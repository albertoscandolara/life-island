import {
  ChangeDetectionStrategy,
  Component,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import type {
  HouseInsuranceDto,
  HouseInternetDto,
  HouseServiceDocumentDto,
  HouseServicesDto,
  PropertyDto,
} from '@life-island/contracts';
import { NgTemplateOutlet } from '@angular/common';
import { UiBadge } from '@life-island/design-system';
import { EntityLink } from '@life-island/entities-ui';
import { errorMessage, HomeApi } from '../api/home-api';
import { formatDate, formatEuro } from '../shared/format';

/**
 * What else your documents say about a house: its internet line (contracts
 * and bills) and its insurances, active first. Each document can be moved to
 * another house, or left out when it is not about a house at all.
 */
@Component({
  selector: 'home-house-services',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [UiBadge, EntityLink, NgTemplateOutlet],
  template: `
    @if (internet().length) {
      <section class="block" aria-label="Internet">
        <h4 class="block__title">Internet</h4>
        <ul class="list">
          @for (line of internet(); track line.key) {
            <li class="item" [class.item--old]="line.status === 'ENDED'">
              <div class="item__what">
                @if (line.provider) {
                  <li-entity-link kind="organization" [name]="line.provider" />
                } @else {
                  <strong>Unknown provider</strong>
                }
                @if (line.status === 'ENDED') {
                  <ui-badge>Ended</ui-badge>
                } @else {
                  <ui-badge tone="success">Active</ui-badge>
                }
              </div>
              <div class="item__facts muted">
                @if (line.offerName) {
                  <span>{{ line.offerName }}</span>
                }
                @if (line.lineNumber) {
                  <span class="mono">{{ line.lineNumber }}</span>
                }
                @if (line.customerCode) {
                  <span
                    >customer
                    <span class="mono">{{ line.customerCode }}</span></span
                  >
                }
                @if (line.monthlyCost !== null) {
                  <span>{{ euro(line.monthlyCost) }}/month</span>
                }
                @if (line.lastBill; as bill) {
                  <span
                    >last bill {{ euro(bill.amount) }} ·
                    {{ date(bill.date) }}</span
                  >
                }
                @if (line.yearCost) {
                  <span>{{ euro(line.yearCost) }} in 12 months</span>
                }
              </div>
              <ng-container
                [ngTemplateOutlet]="docs"
                [ngTemplateOutletContext]="{ $implicit: line.documents }"
              />
            </li>
          }
        </ul>
      </section>
    }
    @if (insurances().length) {
      <section class="block" aria-label="Insurances">
        <h4 class="block__title">Insurances</h4>
        <ul class="list">
          @for (policy of insurances(); track policy.key) {
            <li class="item" [class.item--old]="policy.status === 'EXPIRED'">
              <div class="item__what">
                @if (policy.insurer) {
                  <li-entity-link kind="organization" [name]="policy.insurer" />
                } @else {
                  <strong>Unknown insurer</strong>
                }
                @switch (policy.status) {
                  @case ('ACTIVE') {
                    <ui-badge tone="success">Active</ui-badge>
                  }
                  @case ('EXPIRED') {
                    <ui-badge tone="danger">Expired</ui-badge>
                  }
                  @default {
                    <ui-badge tone="warning">No end date read</ui-badge>
                  }
                }
              </div>
              <div class="item__facts muted">
                @if (policy.coverage) {
                  <span>{{ policy.coverage }}</span>
                }
                @if (policy.policyNumber) {
                  <span
                    >policy
                    <span class="mono">{{ policy.policyNumber }}</span></span
                  >
                }
                @if (policy.startDate || policy.endDate) {
                  <span>{{ span(policy.startDate, policy.endDate) }}</span>
                }
                @if (policy.premium !== null) {
                  <span>{{ euro(policy.premium) }}</span>
                }
              </div>
              <ng-container
                [ngTemplateOutlet]="docs"
                [ngTemplateOutletContext]="{ $implicit: policy.documents }"
              />
            </li>
          }
        </ul>
      </section>
    }
    @if (error(); as message) {
      <p class="error" role="alert">{{ message }}</p>
    }

    <ng-template #docs let-list>
      <details class="docs">
        <summary class="muted">
          {{ list.length }} {{ list.length === 1 ? 'document' : 'documents' }}
        </summary>
        <ul>
          @for (d of list; track d.uploadId) {
            <li class="doc" [class.doc--busy]="busy() === d.uploadId">
              <a
                [href]="api.previewUrl(d.uploadId)"
                target="_blank"
                rel="noopener"
                >{{ d.title }}</a
              >
              <span class="muted">
                {{ d.role === 'BILL' ? 'bill' : 'contract' }} ·
                {{ date(d.date) }}
                @if (d.amount !== null) {
                  · {{ euro(d.amount) }}
                }
              </span>
              <select
                class="ui-input compact"
                [attr.aria-label]="'House of ' + d.title"
                [disabled]="busy() !== null"
                (change)="move(d, $any($event.target).value)"
              >
                <option value="" [selected]="!houseId()">No house</option>
                @for (h of houses(); track h.id) {
                  <option [value]="h.id" [selected]="h.id === houseId()">
                    {{ h.name }}
                  </option>
                }
                @if (d.manual) {
                  <option value="auto">Match it again</option>
                }
                <option value="exclude">Not about a house</option>
              </select>
            </li>
          }
        </ul>
      </details>
    </ng-template>
  `,
  styles: `
    :host {
      display: grid;
      gap: var(--space-3);
    }
    .block__title {
      margin: 0 0 var(--space-2);
      color: var(--text-muted);
      font-size: var(--text-xs);
      font-weight: 600;
    }
    .list {
      display: grid;
      gap: var(--space-2);
      margin: 0;
      padding: 0;
      list-style: none;
    }
    .item {
      display: grid;
      gap: var(--space-1);
      padding: var(--space-2) var(--space-3);
      border: 1px solid var(--border-subtle);
      border-radius: var(--radius-md);
    }
    .item--old {
      opacity: 0.7;
    }
    .item__what {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: var(--space-2);
    }
    .item__facts {
      display: flex;
      flex-wrap: wrap;
      gap: var(--space-1) var(--space-3);
      font-size: var(--text-sm);
    }
    .mono {
      font-family: var(--font-mono, monospace);
    }
    .docs summary {
      cursor: pointer;
      font-size: var(--text-sm);
    }
    .docs ul {
      display: grid;
      gap: var(--space-1);
      margin: var(--space-2) 0 0;
      padding: 0;
      list-style: none;
    }
    .doc {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: var(--space-2);
      font-size: var(--text-sm);
    }
    .doc select {
      width: auto;
    }
    .doc--busy {
      opacity: 0.6;
    }
    .error {
      margin: 0;
      color: var(--danger);
    }
  `,
})
export class HouseServices {
  protected readonly api = inject(HomeApi);

  /** The house they are shown under; null for documents of no house. */
  readonly houseId = input<string | null>(null);
  readonly internet = input<HouseInternetDto[]>([]);
  readonly insurances = input<HouseInsuranceDto[]>([]);
  readonly houses = input<PropertyDto[]>([]);
  /** The lines and insurances after a document moved. */
  readonly changed = output<HouseServicesDto>();

  protected readonly busy = signal<string | null>(null);
  protected readonly error = signal<string | null>(null);

  protected readonly euro = formatEuro;
  protected readonly date = formatDate;

  protected span(from: string | null, to: string | null): string {
    return [from, to].map((d) => (d ? formatDate(d) : '?')).join(' – ');
  }

  protected move(document: HouseServiceDocumentDto, target: string): void {
    this.busy.set(document.uploadId);
    this.error.set(null);
    const request =
      target === 'auto'
        ? { automaticProperty: true as const }
        : target === 'exclude'
          ? { excluded: true }
          : { propertyId: target || null };
    this.api.updateHouseServiceDocument(document.uploadId, request).subscribe({
      next: (services) => {
        this.busy.set(null);
        this.changed.emit(services);
      },
      error: (error) => {
        this.busy.set(null);
        this.error.set(errorMessage(error));
      },
    });
  }
}
