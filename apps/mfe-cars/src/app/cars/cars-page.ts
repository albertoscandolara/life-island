import { DatePipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
} from '@angular/core';
import {
  CAR_DOCUMENT_ROLE_LABELS,
  CAR_DOCUMENT_STATUS_LABELS,
  COST_KIND_LABELS,
  identifiesVehicle,
  MODEL_MAX_BYTES,
  modelFormatOf,
  REGISTRATION_CODES,
  REGISTRATION_CODE_MEANINGS,
  RENEWABLE_LABELS,
  VEHICLE_FIELD_DEFINITIONS,
  VEHICLE_OPTION_LABELS,
  VEHICLE_STATUS_LABELS,
  VEHICLE_STATUSES,
  type CarDocumentPartDto,
  type CarDocumentSeriesDto,
  type CarDocumentStatus,
  type CarDocumentVersionDto,
  type CarsOverviewDto,
  type CostKind,
  type PendingCarReviewDto,
  type RenewalLevel,
  type UpdateVehicleRequest,
  type VehicleChangeSuggestion,
  type VehicleDto,
  type VehicleField,
  type VehicleStatus,
  type VehicleValue,
} from '@life-island/contracts';
import {
  UiAlert,
  UiBadge,
  UiButton,
  UiCard,
  UiEmptyState,
  UiIcon,
  UiPageHeader,
  type UiTone,
} from '@life-island/design-system';
import type { Observable } from 'rxjs';
import { CarsApi } from '../api/cars-api';
import { GarageView } from './garage-view';
import {
  alertText,
  italianNumber,
  renewalText,
  typeLabel,
  valueText,
  vehicleName,
} from './labels';

/** The choices you make on one document waiting for review. */
interface Draft {
  /** The car it is about; 'new' adds one from it. */
  vehicleId: string;
  accept: Set<VehicleField>;
  /** The name of a new car. */
  label: string;
}

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

const STATUS_TONES: Record<CarDocumentStatus, UiTone> = {
  current: 'success',
  expired: 'danger',
  superseded: 'neutral',
  cancelled: 'warning',
};

const LEVEL_TONES: Record<RenewalLevel, UiTone> = {
  ok: 'success',
  expiring: 'warning',
  grace: 'warning',
  expired: 'danger',
  missing: 'neutral',
};

const LEVEL_LABELS: Record<RenewalLevel, string> = {
  ok: 'In order',
  expiring: 'Expiring',
  grace: 'Grace period',
  expired: 'Expired',
  missing: 'Missing',
};

const SUGGESTION_LABELS: Record<VehicleChangeSuggestion, string> = {
  accept: 'Take it',
  keep_current: 'Keep yours',
  check: 'Check it',
};

const SUGGESTION_TONES: Record<VehicleChangeSuggestion, UiTone> = {
  accept: 'success',
  keep_current: 'neutral',
  check: 'warning',
};

/** Codes that head the ones under them on the card. */
const GROUP_CODES = new Set(['C.1', 'C.2', 'C.3', 'O', 'P', 'U', 'V']);

const DEFINITION = new Map<string, Definition>(
  VEHICLE_FIELD_DEFINITIONS.map((d) => [d.field, d]),
);

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
    DatePipe,
    GarageView,
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
  styleUrl: './cars-page.css',
})
export class CarsPage {
  private readonly api = inject(CarsApi);

  protected readonly overview = signal<CarsOverviewDto | null>(null);
  protected readonly error = signal<string | null>(null);
  protected readonly busy = signal<string | null>(null);
  protected readonly selectedId = signal<string | null>(null);
  private readonly drafts = signal<Record<string, Draft>>({});
  /** Remove, being confirmed on the selected car. */
  protected readonly removing = signal(false);
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
  protected readonly statusLabels = CAR_DOCUMENT_STATUS_LABELS;
  protected readonly roleLabels = CAR_DOCUMENT_ROLE_LABELS;
  protected readonly statusTones = STATUS_TONES;
  protected readonly levelTones = LEVEL_TONES;
  protected readonly levelLabels = LEVEL_LABELS;
  protected readonly renewableLabels = RENEWABLE_LABELS;
  protected readonly suggestionLabels = SUGGESTION_LABELS;
  protected readonly suggestionTones = SUGGESTION_TONES;
  protected readonly vehicleStatuses = VEHICLE_STATUSES;
  protected readonly vehicleStatusLabels = VEHICLE_STATUS_LABELS;
  protected readonly optionLabels = VEHICLE_OPTION_LABELS;
  protected readonly costKindLabels = COST_KIND_LABELS;

  protected readonly vehicles = computed(() => this.overview()?.vehicles ?? []);
  protected readonly reviews = computed(() => this.overview()?.reviews ?? []);
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
    this.load();
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
  protected readonly renewalText = renewalText;
  protected readonly valueText = valueText;

  protected select(vehicleId: string): void {
    this.selectedId.set(vehicleId);
    this.editing.set(null);
    this.removing.set(false);
  }

  protected label(field: VehicleField): string {
    return DEFINITION.get(field)?.label ?? field;
  }

  protected value(vehicle: VehicleDto, field: string): VehicleValue {
    return vehicle.values[field as VehicleField] ?? null;
  }

  protected alertOf(vehicle: VehicleDto, uploadId: string) {
    return vehicle.alerts.find((a) => a.uploadId === uploadId) ?? null;
  }

  /** Years with costs, newest first, and the kinds that appear in them. */
  protected costTable(vehicle: VehicleDto) {
    const years = [...new Set(vehicle.costTotals.map((t) => t.year))];
    const kinds = [...new Set(vehicle.costTotals.map((t) => t.kind))];
    return {
      kinds,
      years: years.map((year) => {
        const of = (kind: CostKind) =>
          vehicle.costTotals.find((t) => t.year === year && t.kind === kind)
            ?.total ?? null;
        return {
          year,
          totals: kinds.map(of),
          total: vehicle.costTotals
            .filter((t) => t.year === year)
            .reduce((sum, t) => sum + t.total, 0),
        };
      }),
    };
  }

  // ---- review -------------------------------------------------------------

  protected draft(review: PendingCarReviewDto): Draft {
    return (
      this.drafts()[review.uploadId] ?? {
        vehicleId:
          review.vehicleId ??
          (identifiesVehicle(review)
            ? 'new'
            : (this.vehicles()[0]?.id ?? 'new')),
        accept: new Set(
          review.changes
            .filter((c) => c.suggestion === 'accept')
            .map((c) => c.field),
        ),
        label: '',
      }
    );
  }

  private update(review: PendingCarReviewDto, change: Partial<Draft>): void {
    this.drafts.update((all) => ({
      ...all,
      [review.uploadId]: { ...this.draft(review), ...change },
    }));
  }

  protected chooseVehicle(review: PendingCarReviewDto, vehicleId: string) {
    this.update(review, { vehicleId });
  }

  protected setDraftLabel(review: PendingCarReviewDto, label: string) {
    this.update(review, { label });
  }

  protected toggle(review: PendingCarReviewDto, field: VehicleField): void {
    const accept = new Set(this.draft(review).accept);
    if (accept.has(field)) accept.delete(field);
    else accept.add(field);
    this.update(review, { accept });
  }

  /** The changes against the car you picked (the server compared with its match). */
  protected changesFor(review: PendingCarReviewDto) {
    return this.draft(review).vehicleId === review.vehicleId
      ? review.changes
      : [];
  }

  /** Whether it names a car: a plate or a VIN. Without, it never makes a new car. */
  protected readable(review: PendingCarReviewDto): boolean {
    return identifiesVehicle(review);
  }

  protected isNewVehicle(review: PendingCarReviewDto): boolean {
    return this.draft(review).vehicleId === 'new';
  }

  protected approve(review: PendingCarReviewDto): void {
    const draft = this.draft(review);
    const isNew = draft.vehicleId === 'new';
    this.run(review.uploadId, () =>
      this.api.approve(review.uploadId, {
        vehicleId: isNew ? null : draft.vehicleId,
        accept: this.changesFor(review)
          .map((c) => c.field)
          .filter((field) => draft.accept.has(field)),
        ...(isNew ? { label: draft.label.trim() || null } : {}),
      }),
    );
  }

  protected reject(review: PendingCarReviewDto): void {
    this.run(review.uploadId, () => this.api.reject(review.uploadId));
  }

  protected reopen(uploadId: string): void {
    this.run(uploadId, () => this.api.reopen(uploadId));
  }

  protected mark(uploadId: string, value: string): void {
    const status = value === 'cancelled' ? value : null;
    this.run(uploadId, () => this.api.mark(uploadId, { status }));
  }

  /** The documents of the other versions of a series, to put in this one. */
  protected attachable(
    series: CarDocumentSeriesDto,
    version: CarDocumentVersionDto,
  ): CarDocumentPartDto[] {
    return series.versions
      .filter((v) => v.uploadId !== version.uploadId)
      .flatMap((v) => v.documents);
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
    this.editing.set({
      label: vehicle.label ?? '',
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
        this.drafts.update((all) => {
          const rest = { ...all };
          delete rest[key];
          return rest;
        });
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
