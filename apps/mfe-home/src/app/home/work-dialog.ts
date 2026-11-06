import {
  ChangeDetectionStrategy,
  Component,
  effect,
  inject,
  input,
  model,
  output,
  signal,
} from '@angular/core';
import {
  WORK_KIND_LABELS,
  WORK_KINDS,
  WORK_STATUS_LABELS,
  WORK_STATUSES,
  type KnownCompanyDto,
  type WorkDto,
  type WorkKind,
  type WorkStatus,
} from '@life-island/contracts';
import {
  UiAlert,
  UiButton,
  UiDialog,
  UiFormField,
  UiInput,
} from '@life-island/design-system';
import { errorMessage, HomeApi } from '../api/home-api';
import { PropertyStore } from '../shared/property-store';

interface Draft {
  propertyId: string;
  title: string;
  kind: WorkKind;
  status: WorkStatus;
  area: string;
  contractor: string;
  startDate: string;
  endDate: string;
  estimatedCost: string;
  actualCost: string;
  notes: string;
}

const money = (text: string): number | null => {
  const value = Number(text.replace(',', '.'));
  return text.trim() && Number.isFinite(value) ? value : null;
};

/** Add or edit a renovation, repair or maintenance job. */
@Component({
  selector: 'home-work-dialog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [UiDialog, UiButton, UiFormField, UiInput, UiAlert],
  template: `
    <ui-dialog
      [(open)]="open"
      [heading]="work() ? 'Edit work' : 'New work'"
      size="lg"
      [dismissible]="!saving()"
    >
      @if (error(); as message) {
        <ui-alert tone="danger" class="error">{{ message }}</ui-alert>
      }
      <form
        id="work-form"
        class="form"
        (submit)="$event.preventDefault(); save()"
      >
        <ui-form-field label="What">
          <input
            uiInput
            required
            placeholder="e.g. New bathroom, boiler service"
            [value]="draft().title"
            (input)="patch('title', $event)"
          />
        </ui-form-field>
        <div class="row">
          <ui-form-field label="Home">
            <select class="ui-input" (change)="patch('propertyId', $event)">
              @for (p of store.properties() ?? []; track p.id) {
                <option [value]="p.id" [selected]="p.id === draft().propertyId">
                  {{ p.name }}
                </option>
              }
            </select>
          </ui-form-field>
          <ui-form-field label="Kind">
            <select class="ui-input" (change)="patch('kind', $event)">
              @for (k of kinds; track k) {
                <option [value]="k" [selected]="k === draft().kind">
                  {{ kindLabels[k] }}
                </option>
              }
            </select>
          </ui-form-field>
          <ui-form-field label="Status">
            <select class="ui-input" (change)="patch('status', $event)">
              @for (s of statuses; track s) {
                <option [value]="s" [selected]="s === draft().status">
                  {{ statusLabels[s] }}
                </option>
              }
            </select>
          </ui-form-field>
        </div>
        <div class="row">
          <ui-form-field label="Where" hint="Room or part of the home">
            <input
              uiInput
              placeholder="Bathroom, roof, boiler…"
              [value]="draft().area"
              (input)="patch('area', $event)"
            />
          </ui-form-field>
          <ui-form-field
            label="Who"
            hint="Company or tradesperson: pick one already known, or type it"
          >
            <datalist id="work-known-companies">
              @for (c of companies(); track c.name) {
                <option [value]="c.name"></option>
              }
            </datalist>
            <input
              uiInput
              list="work-known-companies"
              autocomplete="off"
              [value]="draft().contractor"
              (input)="patch('contractor', $event)"
            />
          </ui-form-field>
        </div>
        <div class="row">
          <ui-form-field label="Started">
            <input
              uiInput
              type="date"
              [value]="draft().startDate"
              (input)="patch('startDate', $event)"
            />
          </ui-form-field>
          <ui-form-field label="Finished">
            <input
              uiInput
              type="date"
              [value]="draft().endDate"
              (input)="patch('endDate', $event)"
            />
          </ui-form-field>
          <ui-form-field label="Estimate (€)">
            <input
              uiInput
              inputmode="decimal"
              [value]="draft().estimatedCost"
              (input)="patch('estimatedCost', $event)"
            />
          </ui-form-field>
          <ui-form-field label="Final cost (€)">
            <input
              uiInput
              inputmode="decimal"
              [value]="draft().actualCost"
              (input)="patch('actualCost', $event)"
            />
          </ui-form-field>
        </div>
        <ui-form-field label="Notes">
          <textarea
            uiInput
            [value]="draft().notes"
            (input)="patch('notes', $event)"
          ></textarea>
        </ui-form-field>
      </form>
      <div uiDialogFooter>
        <button
          uiButton
          variant="secondary"
          type="button"
          [disabled]="saving()"
          (click)="open.set(false)"
        >
          Cancel
        </button>
        <button
          uiButton
          type="submit"
          form="work-form"
          [loading]="saving()"
          [disabled]="!draft().title.trim() || !draft().propertyId"
        >
          {{ work() ? 'Save' : 'Add work' }}
        </button>
      </div>
    </ui-dialog>
  `,
  styles: `
    .error {
      margin-bottom: var(--space-4);
    }
    .form {
      display: grid;
      gap: var(--space-4);
    }
    .row {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(10rem, 1fr));
      gap: var(--space-4);
    }
  `,
})
export class WorkDialog {
  private readonly api = inject(HomeApi);
  protected readonly store = inject(PropertyStore);

  readonly open = model(false);
  /** The work to edit; null for a new one. */
  readonly work = input<WorkDto | null>(null);
  /** The home a new work starts on. */
  readonly propertyId = input<string | null>(null);
  readonly saved = output<WorkDto>();

  protected readonly kinds = WORK_KINDS;
  protected readonly statuses = WORK_STATUSES;
  protected readonly kindLabels = WORK_KIND_LABELS;
  protected readonly statusLabels = WORK_STATUS_LABELS;
  protected readonly draft = signal<Draft>(this.blank());
  protected readonly saving = signal(false);
  protected readonly error = signal<string | null>(null);
  /** Companies already on your bills, houses and works. */
  protected readonly companies = signal<KnownCompanyDto[]>([]);

  constructor() {
    // A fresh form each time the dialog opens.
    effect(() => {
      if (!this.open()) return;
      this.api.companies().subscribe({
        next: (companies) => this.companies.set(companies),
        error: () => this.companies.set([]),
      });
      const work = this.work();
      this.error.set(null);
      this.draft.set(
        work
          ? {
              propertyId: work.propertyId,
              title: work.title,
              kind: work.kind,
              status: work.status,
              area: work.area ?? '',
              contractor: work.contractor ?? '',
              startDate: work.startDate ?? '',
              endDate: work.endDate ?? '',
              estimatedCost: work.estimatedCost?.toString() ?? '',
              actualCost: work.actualCost?.toString() ?? '',
              notes: work.notes ?? '',
            }
          : this.blank(),
      );
    });
  }

  protected patch(key: keyof Draft, event: Event): void {
    const value = (event.target as HTMLInputElement).value;
    this.draft.update((d) => ({ ...d, [key]: value }));
  }

  protected save(): void {
    const d = this.draft();
    const request = {
      propertyId: d.propertyId,
      title: d.title.trim(),
      kind: d.kind,
      status: d.status,
      area: d.area.trim() || null,
      contractor: d.contractor.trim() || null,
      startDate: d.startDate || null,
      endDate: d.endDate || null,
      estimatedCost: money(d.estimatedCost),
      actualCost: money(d.actualCost),
      notes: d.notes.trim() || null,
    };
    const work = this.work();
    this.saving.set(true);
    (work
      ? this.api.updateWork(work.id, request)
      : this.api.createWork(request)
    ).subscribe({
      next: (saved) => {
        this.saving.set(false);
        this.open.set(false);
        this.saved.emit(saved);
      },
      error: (error) => {
        this.saving.set(false);
        this.error.set(errorMessage(error));
      },
    });
  }

  private blank(): Draft {
    return {
      propertyId: this.propertyId?.() ?? this.store.properties()?.[0]?.id ?? '',
      title: '',
      kind: 'REPAIR',
      status: 'PLANNED',
      area: '',
      contractor: '',
      startDate: '',
      endDate: '',
      estimatedCost: '',
      actualCost: '',
      notes: '',
    };
  }
}
