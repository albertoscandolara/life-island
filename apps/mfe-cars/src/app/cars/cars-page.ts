import { EntityLink } from '@life-island/entities-ui';
import { DatePipe } from '@angular/common';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute } from '@angular/router';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
} from '@angular/core';
import {
  entityParam,
  MODEL_MAX_BYTES,
  modelFormatOf,
  REGISTRATION_CODES,
  REGISTRATION_CODE_MEANINGS,
  RENEWABLE_LABELS,
  VEHICLE_FIELD_DEFINITIONS,
  VEHICLE_PARTY_FIELDS,
  VEHICLE_OPTION_LABELS,
  VEHICLE_STATUS_LABELS,
  VEHICLE_STATUSES,
  type CarsOverviewDto,
  type CarsPeopleDto,
  type UpdateVehicleRequest,
  type VehiclePartyField,
  type VehicleDto,
  type VehicleField,
  type VehicleStatus,
  type VehicleValue,
  TO_REVIEW_TAB,
} from '@life-island/contracts';
import {
  UiAlert,
  UiBadge,
  UiButton,
  UiCard,
  UiEmptyState,
  UiIcon,
  UiPageHeader,
} from '@life-island/design-system';
import type { Observable } from 'rxjs';
import { CarsApi } from '../api/cars-api';
import { CarCostsCard } from './car-costs-card';
import { CarFinesCard } from './car-fines-card';
import { CarRenewalsCard } from './car-renewals-card';
import { CarReviewCard } from './car-review-card';
import { CarSeriesCard } from './car-series-card';
import { CarTyresCard } from './car-tyres-card';
import { CarUsageCard } from './car-usage-card';
import { GarageView } from './garage-view';
import { InsuranceHistoryCard } from './insurance-history-card';
import { InsuranceQuotesPanel } from './insurance-quotes-panel';
import {
  alertText,
  italianNumber,
  typeLabel,
  valueText,
  vehicleName,
} from './labels';
import {
  LiNeedsYou,
  LiTabs,
  urlTab,
  type LiTab,
} from '@life-island/records-ui';

type Definition = (typeof VEHICLE_FIELD_DEFINITIONS)[number];

/** One line of the carta di circolazione: a code, its meaning and what it holds. */
interface CodeRow {
  code: string;
  meaning: string;
  printed: string;
  /** A code that heads others (C.1, P, V...). */
  group: boolean;
  fields: Definition[];
}

/** Codes that head the ones under them on the card. */
const GROUP_CODES = new Set(['C.1', 'C.2', 'C.3', 'O', 'P', 'U', 'V']);

/**
 * Cars: every car you have with every field of its carta di circolazione
 * (each code next to its meaning), the review of the documents that come in,
 * a new car suggested when one names a plate you do not have, the renewals
 * of each car (insurance, road tax, revisione, service) with warnings, and
 * what each car costs.
 */
@Component({
  selector: 'cars-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    LiNeedsYou,
    LiTabs,
    EntityLink,
    CarCostsCard,
    CarFinesCard,
    CarRenewalsCard,
    CarReviewCard,
    CarSeriesCard,
    CarTyresCard,
    CarUsageCard,
    DatePipe,
    GarageView,
    InsuranceHistoryCard,
    InsuranceQuotesPanel,
    UiAlert,
    UiBadge,
    UiButton,
    UiCard,
    UiEmptyState,
    UiIcon,
    UiPageHeader,
  ],
  host: { 'data-character': 'velo', class: 'cars' },
  templateUrl: './cars-page.html',
  styleUrls: ['./cars-bits.css', './cars-page.css'],
})
export class CarsPage {
  private readonly api = inject(CarsApi);

  protected readonly overview = signal<CarsOverviewDto | null>(null);
  protected readonly error = signal<string | null>(null);
  protected readonly busy = signal<string | null>(null);
  protected readonly selectedId = signal<string | null>(null);
  /** Remove, being confirmed on the selected car. */
  protected readonly removing = signal(false);
  /** The people of People, offered as the holder and owner while editing. */
  protected readonly people = signal<CarsPeopleDto>({
    people: [],
    available: true,
  });
  /** The values being edited on the selected car, or null when not editing. */
  protected readonly editing = signal<Record<string, string> | null>(null);
  /** Adding a car by hand: its plate and name. */
  protected readonly adding = signal<{ plate: string; label: string } | null>(
    null,
  );
  /** Every code of the card, or only the ones Life Island reads. */
  protected readonly allCodes = signal(false);

  protected readonly definitions = VEHICLE_FIELD_DEFINITIONS;
  protected readonly codeMeanings = REGISTRATION_CODE_MEANINGS;
  protected readonly renewableLabels = RENEWABLE_LABELS;
  protected readonly vehicleStatuses = VEHICLE_STATUSES;
  protected readonly vehicleStatusLabels = VEHICLE_STATUS_LABELS;
  protected readonly optionLabels = VEHICLE_OPTION_LABELS;

  protected readonly vehicles = computed(() => this.overview()?.vehicles ?? []);
  protected readonly reviews = computed(() => this.overview()?.reviews ?? []);
  /**
   * The page's tabs: the cars themselves, and "To review", where the
   * documents read for this area wait for you (`?tab=review`, the same in
   * every area that takes documents).
   */
  protected readonly tab = urlTab(['cars', TO_REVIEW_TAB], 'cars');
  protected readonly tabs = computed<LiTab[]>(() => [
    { id: 'cars', label: 'Your cars', icon: 'wrench' },
    {
      id: TO_REVIEW_TAB,
      label: 'To review',
      icon: 'inbox',
      count: this.reviews().length,
    },
  ]);
  protected readonly alerts = computed(() => this.overview()?.alerts ?? []);
  protected readonly rejected = computed(() => this.overview()?.rejected ?? []);
  protected readonly selected = computed<VehicleDto | null>(
    () =>
      this.vehicles().find((v) => v.id === this.selectedId()) ??
      this.vehicles().at(0) ??
      null,
  );

  /** The card's codes in order, each with the fields it fills. */
  protected readonly codeRows = computed<CodeRow[]>(() => {
    const rows = REGISTRATION_CODES.map((c) => ({
      code: c.code,
      meaning: c.meaning,
      printed: c.printed,
      group: GROUP_CODES.has(c.code),
      fields: VEHICLE_FIELD_DEFINITIONS.filter((d) => d.code === c.code),
    }));
    return this.allCodes()
      ? rows
      : rows.filter((r) => r.fields.length || r.group);
  });

  constructor() {
    // A link from anywhere on the island opens one car: /cars?car=<id>.
    inject(ActivatedRoute)
      .queryParamMap.pipe(takeUntilDestroyed())
      .subscribe((query) => {
        const id = query.get(entityParam('vehicle'));
        if (id) this.selectedId.set(id);
      });
    this.load();
    this.loadPeople();
  }

  /** The people of People: offered while editing, and their licence shown next to a car. */
  private loadPeople(): void {
    this.api.people().subscribe({
      next: (people) => this.people.set(people),
      error: () => this.people.set({ people: [], available: false }),
    });
  }

  /**
   * The driving licence of the person a party is, as People has it: a badge
   * next to the holder and the owner of the car.
   */
  protected licenceOf(
    vehicle: VehicleDto,
    field: string,
  ): {
    text: string;
    tone: 'success' | 'warning' | 'danger' | 'neutral';
  } | null {
    if (!this.isParty(field)) return null;
    const personId = vehicle.people?.[field];
    const person = this.people().people.find((p) => p.id === personId);
    if (!person) return null;
    const licence = person.licence;
    if (!licence) return { text: 'No licence in People', tone: 'neutral' };
    const until = licence.expiryDate
      ? new Date(licence.expiryDate).toLocaleDateString('en-GB', {
          day: 'numeric',
          month: 'short',
          year: 'numeric',
        })
      : null;
    const categories = licence.categories.length
      ? ` (${licence.categories.join(', ')})`
      : '';
    switch (licence.status) {
      case 'expired':
        return {
          text: `Licence expired${until ? ' on ' + until : ''}`,
          tone: 'danger',
        };
      case 'expiring':
        return {
          text: `Licence expires in ${licence.daysLeft} days${categories}`,
          tone: 'warning',
        };
      case 'unusable':
        return { text: 'Licence lost, stolen or withdrawn', tone: 'danger' };
      default:
        return {
          text: `Licence valid${until ? ' until ' + until : ''}${categories}`,
          tone: 'success',
        };
    }
  }

  protected load(): void {
    this.api.overview().subscribe({
      next: (overview) => {
        this.overview.set(overview);
        this.error.set(null);
      },
      error: () =>
        this.error.set(
          'Cars could not be loaded. Is svc-cars running? Try again in a moment.',
        ),
    });
  }

  protected readonly typeLabel = typeLabel;
  protected readonly vehicleName = vehicleName;
  protected readonly alertText = alertText;
  protected readonly num = italianNumber;
  protected readonly maxMb = MODEL_MAX_BYTES / 1024 / 1024;
  /** Today in Rome, as the fines' deadlines count it. */
  protected readonly today = new Date().toLocaleDateString('sv-SE', {
    timeZone: 'Europe/Rome',
  });
  protected readonly valueText = valueText;

  protected select(vehicleId: string): void {
    this.selectedId.set(vehicleId);
    this.editing.set(null);
    this.removing.set(false);
  }

  protected value(vehicle: VehicleDto, field: string): VehicleValue {
    return vehicle.values[field as VehicleField] ?? null;
  }

  /** Brings back a document rejected as not about any car. */
  protected reopen(uploadId: string): void {
    this.run(uploadId, () => this.api.reopen(uploadId));
  }

  // ---- cars ----------------------------------------------------------------

  protected megabytes(bytes: number): string {
    return bytes < 1024 * 1024
      ? `${italianNumber(Math.max(1, Math.round(bytes / 1024)), 0, 0)} KB`
      : `${italianNumber(bytes / 1024 / 1024, 1, 1)} MB`;
  }

  /** Uploads the car's 3D model, which then takes the drawn car's place. */
  protected uploadModel(vehicle: VehicleDto, event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    if (!modelFormatOf(file.name)) {
      this.error.set('Pick a .glb, .gltf or .obj file');
      return;
    }
    if (file.size > MODEL_MAX_BYTES) {
      this.error.set(`A model can be at most ${this.maxMb} MB`);
      return;
    }
    this.run(`model:${vehicle.id}`, () =>
      this.api.uploadModel(vehicle.id, file),
    );
  }

  protected removeModel(vehicle: VehicleDto): void {
    this.run(`model:${vehicle.id}`, () => this.api.deleteModel(vehicle.id));
  }

  protected startAdding(): void {
    this.adding.set({ plate: '', label: '' });
  }

  protected setAdding(change: Partial<{ plate: string; label: string }>) {
    this.adding.update((a) => (a ? { ...a, ...change } : a));
  }

  protected add(): void {
    const draft = this.adding();
    if (!draft?.plate.trim()) return;
    this.busy.set('add');
    this.api
      .createVehicle({
        registrationNumber: draft.plate,
        label: draft.label.trim() || null,
      })
      .subscribe({
        next: ({ id }) => {
          this.busy.set(null);
          this.adding.set(null);
          this.selectedId.set(id);
          this.load();
        },
        error: (error: { error?: { message?: string } }) => {
          this.busy.set(null);
          this.error.set(
            error.error?.message ?? 'That did not work. Please try again.',
          );
        },
      });
  }

  protected setStatus(vehicle: VehicleDto, status: string): void {
    if (!(VEHICLE_STATUSES as readonly string[]).includes(status)) return;
    this.run(vehicle.id, () =>
      this.api.updateVehicle(vehicle.id, { status: status as VehicleStatus }),
    );
  }

  protected remove(vehicle: VehicleDto): void {
    this.run(
      vehicle.id,
      () => this.api.removeVehicle(vehicle.id),
      () => {
        this.removing.set(false);
        this.selectedId.set(null);
      },
    );
  }

  protected edit(vehicle: VehicleDto): void {
    this.selectedId.set(vehicle.id);
    this.loadPeople();
    this.editing.set({
      label: vehicle.label ?? '',
      ...Object.fromEntries(
        VEHICLE_PARTY_FIELDS.map((f) => [
          personKey(f),
          vehicle.people?.[f] ?? '',
        ]),
      ),
      ...Object.fromEntries(
        this.definitions.map((d) => [
          d.field,
          vehicle.values[d.field] === null
            ? ''
            : String(vehicle.values[d.field]),
        ]),
      ),
    });
  }

  protected setValue(field: string, value: string): void {
    this.editing.update((values) =>
      values ? { ...values, [field]: value } : values,
    );
  }

  protected editValue(field: string): string {
    return this.editing()?.[field] ?? '';
  }

  /** The holder and the owner: a person of People, or a name as printed. */
  protected isParty(field: string): field is VehiclePartyField {
    return (VEHICLE_PARTY_FIELDS as readonly string[]).includes(field);
  }

  protected pickedPerson(field: VehiclePartyField): string {
    return this.editValue(personKey(field));
  }

  /** Picks a person (their name becomes the party's), or '' to type a name. */
  protected pickPerson(field: VehiclePartyField, personId: string): void {
    const person = this.people().people.find((p) => p.id === personId);
    this.editing.update((values) =>
      values
        ? {
            ...values,
            [personKey(field)]: personId,
            ...(person ? { [field]: person.name } : {}),
          }
        : values,
    );
  }

  /** The person of People a party of the car is, when you picked one. */
  protected linkedPerson(vehicle: VehicleDto, field: string): boolean {
    return this.isParty(field) && !!vehicle.people?.[field];
  }

  /** The person of People a party (holder, owner) is, when you picked one. */
  protected personIdOf(vehicle: VehicleDto, field: string): string | null {
    return this.isParty(field) ? (vehicle.people?.[field] ?? null) : null;
  }

  protected inputType(definition: Definition): string {
    if (definition.type === 'date') return 'date';
    if (definition.type === 'integer' || definition.type === 'number')
      return 'number';
    return 'text';
  }

  /** Saves what you typed; an emptied field goes back to unknown. */
  protected save(vehicle: VehicleDto): void {
    const values = this.editing();
    if (!values) return;
    const changed: Partial<Record<VehicleField, VehicleValue>> = {};
    for (const d of this.definitions) {
      const raw = values[d.field]?.trim() ?? '';
      const value: VehicleValue =
        raw === ''
          ? null
          : d.type === 'integer' || d.type === 'number'
            ? Number(raw)
            : raw;
      if (value !== vehicle.values[d.field]) changed[d.field] = value;
    }
    const request: UpdateVehicleRequest = { values: changed };
    for (const field of VEHICLE_PARTY_FIELDS) {
      const personId = values[personKey(field)] || null;
      if (personId !== (vehicle.people?.[field] ?? null))
        request.people = { ...request.people, [field]: personId };
    }
    const label = values['label']?.trim() || null;
    if (label !== vehicle.label) request.label = label;
    this.run(
      vehicle.id,
      () => this.api.updateVehicle(vehicle.id, request),
      () => this.editing.set(null),
    );
  }

  protected previewUrl(uploadId: string): string {
    return this.api.previewUrl(uploadId);
  }

  private run(
    key: string,
    call: () => Observable<void>,
    done?: () => void,
  ): void {
    this.busy.set(key);
    call().subscribe({
      next: () => {
        this.busy.set(null);
        done?.();
        this.load();
      },
      error: (error: { error?: { message?: string } }) => {
        this.busy.set(null);
        this.error.set(
          error.error?.message ?? 'That did not work. Please try again.',
        );
      },
    });
  }
}

/** Where the edit form keeps the person picked for a party. */
function personKey(field: VehiclePartyField): string {
  return `person:${field}`;
}
