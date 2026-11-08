import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  signal,
} from '@angular/core';
import {
  PROPERTY_TENURE_LABELS,
  PROPERTY_TYPE_LABELS,
  type BillDto,
  type HomePersonDto,
  type PropertyDto,
  type SupplyContractDto,
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
import { HomeApi } from '../api/home-api';
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
  protected readonly contracts = signal<SupplyContractDto[]>([]);
  protected readonly utilities = UTILITIES;
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
  protected readonly contractSpan = contractSpan;

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
      return {
        house,
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
        contracts: this.contracts().filter((c) => c.propertyId === house.id),
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

  /** People & IDs, where the person is (the shell serves it at /people). */
  protected readonly peopleUrl = '/people';

  protected loadNumbers(): void {
    this.api.bills().subscribe({
      next: (bills) => this.bills.set(bills),
      error: () => this.bills.set([]),
    });
    this.api.works().subscribe({
      next: (works) => this.works.set(works),
      error: () => this.works.set([]),
    });
    this.api.supplyContracts().subscribe({
      next: (contracts) => this.contracts.set(contracts),
      error: () => this.contracts.set([]),
    });
  }
}

/** "1 May 2026 – today" for a contract's billed days. */
export function contractSpan(contract: SupplyContractDto): string {
  const from = contract.from ? formatDate(contract.from) : '?';
  const to =
    contract.status === 'ACTIVE'
      ? 'now'
      : contract.to
        ? formatDate(contract.to)
        : '?';
  return `${from} – ${to}`;
}

/** "Via dei Bandi 10, 37039 Tregnago (VR)", or null without an address. */
export function fullAddress(house: PropertyDto): string | null {
  const town = [house.postalCode, house.city].filter(Boolean).join(' ');
  const line = [house.address, town].filter(Boolean).join(', ');
  return (
    (line && house.province ? `${line} (${house.province})` : line) || null
  );
}
