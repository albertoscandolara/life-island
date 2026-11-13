import { EntityLink } from '@life-island/entities-ui';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  signal,
} from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import {
  PROPERTY_TENURE_LABELS,
  PROPERTY_TYPE_LABELS,
  type BillDto,
  type HomePersonDto,
  type PropertyDto,
  type SupplyPointDto,
  type WorkDto,
  UTILITIES,
} from '@life-island/contracts';
import { Router } from '@angular/router';
import {
  UiAlert,
  UiBadge,
  UiButton,
  UiEmptyState,
  UiIcon,
  UiPageHeader,
} from '@life-island/design-system';
import { errorMessage, HomeApi } from '../api/home-api';
import { addMonths, aggregate, totalIn } from '../bills/aggregate';
import { Sparkline } from '../charts/sparkline';
import { workCost } from '../home/home-page';
import { AreaNav } from '../shared/area-nav';
import {
  addressOf,
  formatDate,
  formatEuro,
  formatEuroRound,
  formatNumber,
  propertyColor,
} from '../shared/format';
import { HouseDialog } from '../shared/house-dialog';
import { PropertyStore } from '../shared/property-store';
import { scopeHouses, selectedIds, selectionParams } from '../shared/selection';
import { HouseSuggestions } from './house-suggestions';
import { HousesView } from './houses-view';

/**
 * Bronto's Houses: every house you have as an entity, like a person in
 * People. What your documents say about a house is suggested for review;
 * each house shows its data, owners, companies, model, and what its bills and
 * renovations add up to. Renovations and Bills are the tabs beside it.
 */
@Component({
  selector: 'home-houses-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    EntityLink,
    UiPageHeader,
    UiButton,
    UiBadge,
    UiIcon,
    UiAlert,
    UiEmptyState,
    AreaNav,
    HousesView,
    HouseDialog,
    HouseSuggestions,
    Sparkline,
    NgTemplateOutlet,
  ],
  host: { 'data-character': 'bronto', class: 'home' },
  templateUrl: './houses-page.html',
  styleUrls: [
    '../shared/kit.css',
    '../home/home-page.css',
    './houses-page.css',
  ],
})
export class HousesPage {
  private readonly api = inject(HomeApi);
  private readonly router = inject(Router);
  protected readonly store = inject(PropertyStore);

  /** `?houses=<id>,<id>`; the older `?property=<id>` works too. */
  readonly houses = input<string>();
  readonly property = input<string>();

  protected readonly bills = signal<BillDto[]>([]);
  protected readonly works = signal<WorkDto[]>([]);
  protected readonly points = signal<SupplyPointDto[]>([]);
  /** The supply point being moved. */
  protected readonly moving = signal<string | null>(null);
  protected readonly pointError = signal<string | null>(null);
  protected readonly people = signal<HomePersonDto[]>([]);
  protected readonly editorOpen = signal(false);
  /** The house being edited; null while adding one. */
  protected readonly editingId = signal<string | null>(null);

  protected readonly typeLabels = PROPERTY_TYPE_LABELS;
  protected readonly tenureLabels = PROPERTY_TENURE_LABELS;
  protected readonly formatEuro = formatEuro;
  protected readonly formatEuroRound = formatEuroRound;
  protected readonly formatNumber = formatNumber;
  protected readonly formatDate = formatDate;
  protected readonly propertyColor = propertyColor;
  protected readonly addressOf = addressOf;

  protected readonly selected = computed(() =>
    selectedIds(this.houses(), this.property()),
  );
  protected readonly scope = computed(() =>
    scopeHouses(this.store.properties() ?? [], this.selected()),
  );
  protected readonly editing = computed(
    () =>
      this.store.properties()?.find((p) => p.id === this.editingId()) ?? null,
  );
  protected readonly residence = computed(
    () => this.store.properties()?.find((p) => p.isResidence) ?? null,
  );

  private readonly last12 = computed(() => {
    const to = new Date().toISOString().slice(0, 7);
    return { from: addMonths(to, -11), to };
  });

  /** One card per house in view: its data, and its bills and works in short. */
  protected readonly cards = computed(() =>
    this.scope().map((house) => {
      const bills = this.bills().filter((b) => b.propertyId === house.id);
      const works = this.works().filter((w) => w.propertyId === house.id);
      const points = this.points().filter((p) => p.propertyId === house.id);
      const known = new Set(points.map((p) => normalize(p.code)));
      return {
        house,
        points,
        // Codes you typed that no bill has shown yet.
        otherCodes: house.supplyCodes.filter((c) => !known.has(normalize(c))),
        address: fullAddress(house),
        residents: this.people().filter(
          (p) => p.residencePropertyId === house.id,
        ),
        billsYear: totalIn(bills, this.last12(), 'period'),
        trend: aggregate(bills, {
          range: this.last12(),
          grain: 'month',
          basis: 'period',
          metric: 'amount',
          keys: ['all'],
          keyOf: () => 'all',
        }).series[0].values,
        open: works.filter((w) => w.status !== 'DONE').length,
        spent: works
          .filter((w) => w.status === 'DONE')
          .reduce((sum, w) => sum + workCost(w), 0),
        companies: (
          [
            ['Electricity', house.electricitySupplier],
            ['Gas', house.gasSupplier],
            ['Water', house.waterSupplier],
            ['Condominium', house.condoManager],
            ['Insurance', house.insurer],
          ] as const
        ).filter(([, name]) => !!name),
        cadastre: [
          house.cadastralSheet && `Sheet ${house.cadastralSheet}`,
          house.cadastralParcel && `parcel ${house.cadastralParcel}`,
          house.cadastralSubunit && `sub ${house.cadastralSubunit}`,
          house.cadastralCategory && `cat. ${house.cadastralCategory}`,
        ]
          .filter(Boolean)
          .join(', '),
      };
    }),
  );

  /** Supply points no house has yet: pick one for them. */
  protected readonly loosePoints = computed(() =>
    this.points().filter((p) => p.propertyId === null),
  );

  constructor() {
    this.loadNumbers();
    this.api.people().subscribe({
      next: ({ people }) => this.people.set(people),
      error: () => this.people.set([]),
    });
  }

  protected add(): void {
    this.editingId.set(null);
    this.editorOpen.set(true);
  }

  protected edit(house: PropertyDto): void {
    this.editingId.set(house.id);
    this.editorOpen.set(true);
  }

  protected onSaved(house: PropertyDto): void {
    // A house just added is the one you want to look at.
    if (!this.editingId()) {
      this.editingId.set(house.id);
      void this.router.navigate([], {
        queryParams: selectionParams([house.id]),
        queryParamsHandling: 'merge',
      });
    }
  }

  protected loadNumbers(): void {
    this.api.bills().subscribe({
      next: (bills) => this.bills.set(bills),
      error: () => this.bills.set([]),
    });
    this.api.supplyPoints().subscribe({
      next: (points) => this.points.set(points),
      error: () => this.points.set([]),
    });
    this.api.works().subscribe({
      next: (works) => this.works.set(works),
      error: () => this.works.set([]),
    });
  }

  /** Puts a supply point on another house: its bills, past and future, follow it. */
  protected movePoint(point: SupplyPointDto, target: string): void {
    this.moving.set(point.id);
    this.pointError.set(null);
    this.api.moveSupplyPoint(point.id, target || null).subscribe({
      next: () => {
        this.moving.set(null);
        this.store.reload();
        this.loadNumbers();
      },
      error: (error) => {
        this.moving.set(null);
        this.pointError.set(errorMessage(error));
      },
    });
  }

  protected utilityLabel(point: SupplyPointDto): string {
    return UTILITIES[point.utility].label;
  }

  /** The contract in force: the one with the latest bill. */
  protected current(point: SupplyPointDto) {
    return point.contracts.find((c) => c.status === 'ACTIVE') ?? null;
  }

  /** The contracts that ran the supply point before, newest first. */
  protected ended(point: SupplyPointDto) {
    return point.contracts.filter((c) => c.status === 'ENDED');
  }

  /** "Jan 2025 – Apr 2026": the days a contract was billed for. */
  protected span(from: string | null, to: string | null): string {
    return [from, to].map((d) => (d ? formatDate(d) : '?')).join(' – ');
  }
}

const normalize = (code: string) => code.replace(/[\s\-./]/g, '').toUpperCase();

/** "Via dei Bandi 10, 37039 Tregnago (VR)", or null without an address. */
export function fullAddress(house: PropertyDto): string | null {
  const town = [house.postalCode, house.city].filter(Boolean).join(' ');
  const line = [house.address, town].filter(Boolean).join(', ');
  return (
    (line && house.province ? `${line} (${house.province})` : line) || null
  );
}
