import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  model,
  output,
  signal,
  untracked,
} from '@angular/core';
import {
  MODEL_MAX_BYTES,
  modelFormatOf,
  PROPERTY_TENURE_LABELS,
  PROPERTY_TENURES,
  PROPERTY_TYPE_LABELS,
  PROPERTY_TYPES,
  type CreatePropertyRequest,
  type HomePersonDto,
  type KnownCompanyDto,
  type PropertyCompanyField,
  type PropertyDto,
  type PropertyTenure,
  type PropertyType,
} from '@life-island/contracts';
import {
  UiAlert,
  UiButton,
  UiConfirmDialog,
  UiDialog,
  UiFormField,
  UiIcon,
  UiInput,
} from '@life-island/design-system';
import { errorMessage, HomeApi } from '../api/home-api';
import { PropertyStore } from './property-store';

/** One owner row while editing: a person of People, or a typed name. */
interface OwnerDraft {
  /** A person id, or '' for a typed name. */
  personId: string;
  name: string;
  share: string;
}

interface Draft {
  name: string;
  type: PropertyType;
  tenure: PropertyTenure;
  isResidence: boolean;
  address: string;
  postalCode: string;
  city: string;
  province: string;
  country: string;
  areaSqm: string;
  rooms: string;
  yearBuilt: string;
  cadastralSheet: string;
  cadastralParcel: string;
  cadastralSubunit: string;
  cadastralCategory: string;
  cadastralIncome: string;
  purchaseDate: string;
  purchasePrice: string;
  owners: OwnerDraft[];
  electricitySupplier: string;
  gasSupplier: string;
  waterSupplier: string;
  condoManager: string;
  insurer: string;
  matchTerms: string;
  supplyCodes: string;
  notes: string;
}

type TextKey = {
  [K in keyof Draft]: Draft[K] extends string ? K : never;
}[keyof Draft];

const COMPANY_LABELS: Record<PropertyCompanyField, string> = {
  electricitySupplier: 'Electricity supplier',
  gasSupplier: 'Gas supplier',
  waterSupplier: 'Water supplier',
  condoManager: 'Condominium manager',
  insurer: 'Insurer',
};

const list = (text: string) =>
  text
    .split(/[,\n]/)
    .map((part) => part.trim())
    .filter((part) => part.length > 1);

const num = (text: string): number | null => {
  const clean = text.trim().replace(/\s|€/g, '');
  if (!clean) return null;
  const value = Number(
    /,\d{1,2}$/.test(clean)
      ? clean.replace(/\./g, '').replace(',', '.')
      : clean.replace(/,/g, ''),
  );
  return Number.isFinite(value) ? value : null;
};

const str = (value: string | number | null | undefined) =>
  value === null || value === undefined ? '' : String(value);

function draftOf(p: PropertyDto | null): Draft {
  return {
    name: p?.name ?? '',
    type: p?.type ?? 'HOUSE',
    tenure: p?.tenure ?? 'OWNED',
    isResidence: p?.isResidence ?? false,
    address: str(p?.address),
    postalCode: str(p?.postalCode),
    city: str(p?.city),
    province: str(p?.province),
    country: str(p?.country ?? 'IT'),
    areaSqm: str(p?.areaSqm),
    rooms: str(p?.rooms),
    yearBuilt: str(p?.yearBuilt),
    cadastralSheet: str(p?.cadastralSheet),
    cadastralParcel: str(p?.cadastralParcel),
    cadastralSubunit: str(p?.cadastralSubunit),
    cadastralCategory: str(p?.cadastralCategory),
    cadastralIncome: str(p?.cadastralIncome),
    purchaseDate: str(p?.purchaseDate),
    purchasePrice: str(p?.purchasePrice),
    owners: (p?.owners ?? []).map((o) => ({
      personId: o.personId ?? '',
      name: o.name,
      share: str(o.share),
    })),
    electricitySupplier: str(p?.electricitySupplier),
    gasSupplier: str(p?.gasSupplier),
    waterSupplier: str(p?.waterSupplier),
    condoManager: str(p?.condoManager),
    insurer: str(p?.insurer),
    matchTerms: (p?.matchTerms ?? []).join(', '),
    supplyCodes: (p?.supplyCodes ?? []).join(', '),
    notes: str(p?.notes),
  };
}

/**
 * Adds or edits a house: everything about it, its owners (a person of People
 * or a typed name), the companies it deals with (one already known or a typed
 * name), whether it is your residence, and its 3D model.
 */
@Component({
  selector: 'home-house-dialog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    UiDialog,
    UiButton,
    UiIcon,
    UiFormField,
    UiInput,
    UiAlert,
    UiConfirmDialog,
  ],
  template: `
    <ui-dialog
      [(open)]="open"
      [heading]="house() ? 'Edit ' + house()!.name : 'Add a house'"
      size="lg"
    >
      @if (error(); as message) {
        <ui-alert tone="danger" class="error">{{ message }}</ui-alert>
      }
      @if (draft(); as d) {
        <form class="form" (submit)="$event.preventDefault(); save(d)">
          <fieldset>
            <legend>The house</legend>
            <ui-form-field label="Name" hint="What you call it, e.g. Tregnago">
              <input
                uiInput
                required
                [value]="d.name"
                (input)="set('name', $event)"
              />
            </ui-form-field>
            <div class="row">
              <label class="field">
                <span>Type</span>
                <select
                  class="ui-input"
                  (change)="patch({ type: $any(value($event)) })"
                >
                  @for (t of types; track t) {
                    <option [value]="t" [selected]="d.type === t">
                      {{ typeLabels[t] }}
                    </option>
                  }
                </select>
              </label>
              <label class="field">
                <span>Yours?</span>
                <select
                  class="ui-input"
                  (change)="patch({ tenure: $any(value($event)) })"
                >
                  @for (t of tenures; track t) {
                    <option [value]="t" [selected]="d.tenure === t">
                      {{ tenureLabels[t] }}
                    </option>
                  }
                </select>
              </label>
            </div>
            <label class="check">
              <input
                type="checkbox"
                [checked]="d.isResidence"
                (change)="patch({ isResidence: checked($event) })"
              />
              <span>
                <strong>This is my residence</strong>
                <small class="muted">
                  You can have many houses, but only one residence.
                  @if (otherResidence(); as other) {
                    Ticking it moves the residence here from {{ other.name }}.
                  }
                </small>
              </span>
            </label>
          </fieldset>

          <fieldset>
            <legend>Address</legend>
            <ui-form-field label="Street and number">
              <input
                uiInput
                [value]="d.address"
                (input)="set('address', $event)"
              />
            </ui-form-field>
            <div class="row row--4">
              <ui-form-field label="Postal code">
                <input
                  uiInput
                  [value]="d.postalCode"
                  (input)="set('postalCode', $event)"
                />
              </ui-form-field>
              <ui-form-field label="City">
                <input uiInput [value]="d.city" (input)="set('city', $event)" />
              </ui-form-field>
              <ui-form-field label="Province">
                <input
                  uiInput
                  maxlength="8"
                  [value]="d.province"
                  (input)="set('province', $event)"
                />
              </ui-form-field>
              <ui-form-field label="Country">
                <input
                  uiInput
                  maxlength="2"
                  [value]="d.country"
                  (input)="set('country', $event)"
                />
              </ui-form-field>
            </div>
          </fieldset>

          <fieldset>
            <legend>Size and land registry</legend>
            <div class="row row--3">
              <ui-form-field label="Floor area (m²)">
                <input
                  uiInput
                  inputmode="decimal"
                  [value]="d.areaSqm"
                  (input)="set('areaSqm', $event)"
                />
              </ui-form-field>
              <ui-form-field label="Rooms">
                <input
                  uiInput
                  inputmode="decimal"
                  [value]="d.rooms"
                  (input)="set('rooms', $event)"
                />
              </ui-form-field>
              <ui-form-field label="Year built">
                <input
                  uiInput
                  inputmode="numeric"
                  [value]="d.yearBuilt"
                  (input)="set('yearBuilt', $event)"
                />
              </ui-form-field>
            </div>
            <div class="row row--3">
              <ui-form-field label="Sheet (foglio)">
                <input
                  uiInput
                  [value]="d.cadastralSheet"
                  (input)="set('cadastralSheet', $event)"
                />
              </ui-form-field>
              <ui-form-field label="Parcel (particella)">
                <input
                  uiInput
                  [value]="d.cadastralParcel"
                  (input)="set('cadastralParcel', $event)"
                />
              </ui-form-field>
              <ui-form-field label="Subunit (subalterno)">
                <input
                  uiInput
                  [value]="d.cadastralSubunit"
                  (input)="set('cadastralSubunit', $event)"
                />
              </ui-form-field>
            </div>
            <div class="row">
              <ui-form-field label="Category" hint="e.g. A/2">
                <input
                  uiInput
                  [value]="d.cadastralCategory"
                  (input)="set('cadastralCategory', $event)"
                />
              </ui-form-field>
              <ui-form-field label="Cadastral income (rendita, €)">
                <input
                  uiInput
                  inputmode="decimal"
                  [value]="d.cadastralIncome"
                  (input)="set('cadastralIncome', $event)"
                />
              </ui-form-field>
            </div>
            <div class="row">
              <ui-form-field label="Bought on">
                <input
                  uiInput
                  type="date"
                  [value]="d.purchaseDate"
                  (input)="set('purchaseDate', $event)"
                />
              </ui-form-field>
              <ui-form-field label="Price (€)">
                <input
                  uiInput
                  inputmode="decimal"
                  [value]="d.purchasePrice"
                  (input)="set('purchasePrice', $event)"
                />
              </ui-form-field>
            </div>
          </fieldset>

          <fieldset>
            <legend>Owners</legend>
            @for (owner of d.owners; track $index; let i = $index) {
              <div class="owner">
                <select
                  class="ui-input"
                  [attr.aria-label]="'Owner ' + (i + 1)"
                  (change)="pickOwner(i, value($event))"
                >
                  <option value="" [selected]="!owner.personId">
                    Type a name…
                  </option>
                  @for (person of people(); track person.id) {
                    <option
                      [value]="person.id"
                      [selected]="owner.personId === person.id"
                    >
                      {{ person.name }}
                    </option>
                  }
                </select>
                @if (!owner.personId) {
                  <input
                    uiInput
                    placeholder="Name"
                    [attr.aria-label]="'Name of owner ' + (i + 1)"
                    [value]="owner.name"
                    (input)="patchOwner(i, { name: value($event) })"
                  />
                }
                <input
                  uiInput
                  class="share"
                  inputmode="decimal"
                  placeholder="Share %"
                  [attr.aria-label]="'Share of owner ' + (i + 1)"
                  [value]="owner.share"
                  (input)="patchOwner(i, { share: value($event) })"
                />
                <button
                  uiButton
                  variant="ghost"
                  size="sm"
                  [iconOnly]="true"
                  type="button"
                  [attr.aria-label]="'Remove owner ' + (i + 1)"
                  (click)="removeOwner(i)"
                >
                  <ui-icon name="x" [size]="14" />
                </button>
              </div>
            }
            <button
              uiButton
              variant="ghost"
              size="sm"
              type="button"
              (click)="addOwner()"
            >
              <ui-icon name="plus" [size]="14" /> Add an owner
            </button>
            @if (!peopleAvailable()) {
              <small class="muted"
                >People is not reachable, so owners are typed for now.</small
              >
            }
          </fieldset>

          <fieldset>
            <legend>Companies</legend>
            <p class="muted small">
              Pick a company already on your bills, houses or works, or type a
              new one.
            </p>
            <datalist id="home-known-companies">
              @for (c of companies(); track c.name) {
                <option [value]="c.name"></option>
              }
            </datalist>
            <div class="row">
              @for (field of companyFields; track field) {
                <ui-form-field [label]="companyLabels[field]">
                  <input
                    uiInput
                    list="home-known-companies"
                    autocomplete="off"
                    [value]="d[field]"
                    (input)="set(field, $event)"
                  />
                </ui-form-field>
              }
            </div>
          </fieldset>

          <fieldset>
            <legend>How its documents are recognised</legend>
            <ui-form-field
              label="Words that identify its documents"
              hint="Comma separated. A bill whose supply address contains one of them belongs here, e.g. ponzilovo"
            >
              <input
                uiInput
                [value]="d.matchTerms"
                (input)="set('matchTerms', $event)"
              />
            </ui-form-field>
            <ui-form-field
              label="Supply points"
              hint="POD (electricity), PDR (gas) or the water supply code, comma separated. Not the customer code: that belongs to a supply contract, read from the bills"
            >
              <input
                uiInput
                [value]="d.supplyCodes"
                (input)="set('supplyCodes', $event)"
              />
            </ui-form-field>
            <ui-form-field label="Notes">
              <textarea
                uiInput
                [value]="d.notes"
                (input)="set('notes', $event)"
              ></textarea>
            </ui-form-field>
          </fieldset>

          @if (house(); as h) {
            <fieldset>
              <legend>3D model</legend>
              @if (h.model; as m) {
                <p class="model">
                  <ui-icon name="file" [size]="16" />
                  <strong>{{ m.filename }}</strong>
                  <span class="muted"
                    >{{ m.format }} · {{ size(m.sizeBytes) }}</span
                  >
                  <button
                    uiButton
                    variant="ghost"
                    size="sm"
                    type="button"
                    [disabled]="uploading()"
                    (click)="removeModel(h)"
                  >
                    <ui-icon name="trash" [size]="14" /> Remove
                  </button>
                </p>
              } @else {
                <p class="muted small">
                  It shows as a little drawn house until you load a model.
                </p>
              }
              <input
                #modelFile
                type="file"
                class="file"
                accept=".glb,.gltf,.obj"
                (change)="uploadModel(h, $event)"
              />
              <button
                uiButton
                variant="secondary"
                size="sm"
                type="button"
                [loading]="uploading()"
                (click)="modelFile.click()"
              >
                <ui-icon name="upload" [size]="14" />
                {{ h.model ? 'Replace the model' : 'Load a model' }}
              </button>
              <small class="muted"
                >A single .glb, .gltf with embedded buffers, or .obj, up to
                {{ maxMb }} MB.</small
              >
            </fieldset>
          }

          <div class="actions">
            @if (house(); as h) {
              <button
                uiButton
                variant="ghost"
                type="button"
                class="delete"
                (click)="removing.set(true)"
              >
                <ui-icon name="trash" [size]="16" /> Delete house
              </button>
            }
            <button
              uiButton
              variant="secondary"
              type="button"
              (click)="open.set(false)"
            >
              Cancel
            </button>
            <button
              uiButton
              type="submit"
              [loading]="saving()"
              [disabled]="!d.name.trim()"
            >
              {{ house() ? 'Save' : 'Add house' }}
            </button>
          </div>
        </form>
      }
    </ui-dialog>

    <ui-confirm-dialog
      [open]="removing()"
      (openChange)="removing.set($event)"
      heading="Delete this house?"
      confirmLabel="Delete"
      tone="danger"
      [busy]="saving()"
      (confirmed)="remove()"
    >
      {{ house()?.name }} and its renovations and repairs will be deleted. Its
      bills stay in your documents and go back to unassigned.
    </ui-confirm-dialog>
  `,
  styles: `
    .error {
      margin-bottom: var(--space-4);
    }
    .form {
      display: grid;
      gap: var(--space-4);
    }
    fieldset {
      display: grid;
      gap: var(--space-3);
      margin: 0;
      padding: var(--space-4);
      border: 1px solid var(--border-subtle);
      border-radius: var(--radius-md);
    }
    legend {
      padding: 0 var(--space-2);
      font-family: var(--font-display);
      font-weight: 600;
    }
    .row {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(12rem, 1fr));
      gap: var(--space-3);
    }
    .row--3 {
      grid-template-columns: repeat(auto-fit, minmax(9rem, 1fr));
    }
    .row--4 {
      grid-template-columns: repeat(auto-fit, minmax(7rem, 1fr));
    }
    .field {
      display: grid;
      gap: var(--space-1);
      font-size: var(--text-sm);
      font-weight: 600;
    }
    .check {
      display: flex;
      align-items: flex-start;
      gap: var(--space-2);
    }
    .check span {
      display: grid;
    }
    .owner {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: var(--space-2);
    }
    .owner > select,
    .owner > input:not(.share) {
      flex: 1 1 12rem;
    }
    .share {
      width: 7rem;
    }
    .model {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: var(--space-2);
      margin: 0;
    }
    .file {
      display: none;
    }
    .actions {
      display: flex;
      justify-content: flex-end;
      gap: var(--space-2);
    }
    .delete {
      margin-right: auto;
    }
    .muted {
      color: var(--text-muted);
    }
    .small,
    small {
      font-size: var(--text-sm);
    }
  `,
})
export class HouseDialog {
  private readonly api = inject(HomeApi);
  private readonly store = inject(PropertyStore);

  readonly open = model(false);
  /** The house to edit; null adds a new one. */
  readonly house = input<PropertyDto | null>(null);
  readonly saved = output<PropertyDto>();

  protected readonly draft = signal<Draft | null>(null);
  protected readonly people = signal<HomePersonDto[]>([]);
  protected readonly peopleAvailable = signal(true);
  protected readonly companies = signal<KnownCompanyDto[]>([]);
  protected readonly saving = signal(false);
  protected readonly uploading = signal(false);
  protected readonly removing = signal(false);
  protected readonly error = signal<string | null>(null);

  protected readonly types = PROPERTY_TYPES;
  protected readonly typeLabels = PROPERTY_TYPE_LABELS;
  protected readonly tenures = PROPERTY_TENURES;
  protected readonly tenureLabels = PROPERTY_TENURE_LABELS;
  protected readonly companyFields = Object.keys(
    COMPANY_LABELS,
  ) as PropertyCompanyField[];
  protected readonly companyLabels = COMPANY_LABELS;
  protected readonly maxMb = MODEL_MAX_BYTES / 1024 / 1024;

  protected readonly otherResidence = computed(
    () =>
      this.store
        .properties()
        ?.find((p) => p.isResidence && p.id !== this.house()?.id) ?? null,
  );

  constructor() {
    // Every time it opens: a fresh draft, and fresh people and companies.
    effect(() => {
      if (!this.open()) return;
      // Not on every change of the house (a model upload), only on opening.
      this.draft.set(draftOf(untracked(() => this.house())));
      this.error.set(null);
      this.api.people().subscribe({
        next: ({ people, available }) => {
          this.people.set(people);
          this.peopleAvailable.set(available);
        },
        error: () => this.peopleAvailable.set(false),
      });
      this.api.companies().subscribe({
        next: (companies) => this.companies.set(companies),
        error: () => this.companies.set([]),
      });
    });
  }

  protected value(event: Event): string {
    return (event.target as HTMLInputElement).value;
  }

  protected checked(event: Event): boolean {
    return (event.target as HTMLInputElement).checked;
  }

  protected set(key: TextKey, event: Event): void {
    this.patch({ [key]: this.value(event) } as Partial<Draft>);
  }

  protected patch(changes: Partial<Draft>): void {
    this.draft.update((d) => (d ? { ...d, ...changes } : d));
  }

  protected addOwner(): void {
    this.patch({
      owners: [
        ...(this.draft()?.owners ?? []),
        { personId: '', name: '', share: '' },
      ],
    });
  }

  protected removeOwner(index: number): void {
    this.patch({
      owners: (this.draft()?.owners ?? []).filter((_, i) => i !== index),
    });
  }

  protected patchOwner(index: number, changes: Partial<OwnerDraft>): void {
    this.patch({
      owners: (this.draft()?.owners ?? []).map((o, i) =>
        i === index ? { ...o, ...changes } : o,
      ),
    });
  }

  protected pickOwner(index: number, personId: string): void {
    const person = this.people().find((p) => p.id === personId);
    this.patchOwner(index, {
      personId,
      name: person?.name ?? this.draft()?.owners[index]?.name ?? '',
    });
  }

  protected size(bytes: number): string {
    return bytes > 1024 * 1024
      ? `${(bytes / 1024 / 1024).toFixed(1)} MB`
      : `${Math.max(1, Math.round(bytes / 1024))} KB`;
  }

  protected save(d: Draft): void {
    const text = (value: string) => value.trim() || null;
    const request: CreatePropertyRequest = {
      name: d.name.trim(),
      type: d.type,
      tenure: d.tenure,
      isResidence: d.isResidence,
      address: text(d.address),
      postalCode: text(d.postalCode),
      city: text(d.city),
      province: text(d.province)?.toUpperCase() ?? null,
      country: text(d.country),
      areaSqm: num(d.areaSqm),
      rooms: num(d.rooms),
      yearBuilt: num(d.yearBuilt),
      cadastralSheet: text(d.cadastralSheet),
      cadastralParcel: text(d.cadastralParcel),
      cadastralSubunit: text(d.cadastralSubunit),
      cadastralCategory: text(d.cadastralCategory),
      cadastralIncome: num(d.cadastralIncome),
      purchaseDate: text(d.purchaseDate),
      purchasePrice: num(d.purchasePrice),
      owners: d.owners
        .filter((o) => o.personId || o.name.trim())
        .map((o) => ({
          personId: o.personId || null,
          name:
            this.people().find((p) => p.id === o.personId)?.name ??
            o.name.trim(),
          share: num(o.share),
        })),
      electricitySupplier: text(d.electricitySupplier),
      gasSupplier: text(d.gasSupplier),
      waterSupplier: text(d.waterSupplier),
      condoManager: text(d.condoManager),
      insurer: text(d.insurer),
      supplyCodes: list(d.supplyCodes),
      notes: text(d.notes),
      // Empty on a new house: the service derives them from the address.
      ...(this.house() || d.matchTerms.trim()
        ? { matchTerms: list(d.matchTerms) }
        : {}),
    };
    const house = this.house();
    this.saving.set(true);
    const call = house
      ? this.api.updateProperty(house.id, request)
      : this.api.createProperty(request);
    call.subscribe({
      next: (saved) => {
        this.saving.set(false);
        this.store.reload();
        this.saved.emit(saved);
        this.open.set(false);
      },
      error: (error) => this.fail(error),
    });
  }

  protected uploadModel(house: PropertyDto, event: Event): void {
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
    this.uploading.set(true);
    this.api.uploadModel(house.id, file).subscribe({
      next: (saved) => this.modelChanged(saved),
      error: (error) => {
        this.uploading.set(false);
        this.error.set(errorMessage(error));
      },
    });
  }

  protected removeModel(house: PropertyDto): void {
    this.uploading.set(true);
    this.api.deleteModel(house.id).subscribe({
      next: (saved) => this.modelChanged(saved),
      error: (error) => {
        this.uploading.set(false);
        this.error.set(errorMessage(error));
      },
    });
  }

  protected remove(): void {
    const house = this.house();
    if (!house) return;
    this.saving.set(true);
    this.api.deleteProperty(house.id).subscribe({
      next: () => {
        this.saving.set(false);
        this.removing.set(false);
        this.open.set(false);
        this.store.reload();
      },
      error: (error) => this.fail(error),
    });
  }

  private modelChanged(saved: PropertyDto): void {
    this.uploading.set(false);
    this.error.set(null);
    this.store.reload();
    this.saved.emit(saved);
  }

  private fail(error: unknown): void {
    this.saving.set(false);
    this.error.set(errorMessage(error));
  }
}
