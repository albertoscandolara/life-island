import {
  ChangeDetectionStrategy,
  Component,
  inject,
  model,
  signal,
} from '@angular/core';
import type { PropertyDto } from '@life-island/contracts';
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
import { addressOf, propertyColor } from './format';
import { PropertyStore } from './property-store';

interface Draft {
  id: string | null;
  name: string;
  address: string;
  city: string;
  matchTerms: string;
  supplyCodes: string;
  notes: string;
}

const list = (text: string) =>
  text
    .split(/[,\n]/)
    .map((part) => part.trim())
    .filter((part) => part.length > 1);

/**
 * Your homes: add one, rename it, and tell the app how to recognise its
 * bills (words of its address, the POD/PDR codes of its supplies).
 */
@Component({
  selector: 'home-properties-dialog',
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
    <ui-dialog [(open)]="open" heading="Your homes" size="lg">
      @if (error(); as message) {
        <ui-alert tone="danger" class="error">{{ message }}</ui-alert>
      }
      @if (draft(); as d) {
        <form class="form" (submit)="$event.preventDefault(); save(d)">
          <ui-form-field
            label="Name"
            hint="What you call it, e.g. Via Ponzilovo"
          >
            <input
              uiInput
              required
              [value]="d.name"
              (input)="patch({ name: value($event) })"
            />
          </ui-form-field>
          <div class="row">
            <ui-form-field label="Address">
              <input
                uiInput
                [value]="d.address"
                (input)="patch({ address: value($event) })"
              />
            </ui-form-field>
            <ui-form-field label="City">
              <input
                uiInput
                [value]="d.city"
                (input)="patch({ city: value($event) })"
              />
            </ui-form-field>
          </div>
          <ui-form-field
            label="Words that identify its bills"
            hint="Comma separated. A bill whose address contains one of them belongs to this home, e.g. ponzilovo"
          >
            <input
              uiInput
              [value]="d.matchTerms"
              (input)="patch({ matchTerms: value($event) })"
            />
          </ui-form-field>
          <ui-form-field
            label="Supply codes"
            hint="POD (electricity), PDR (gas) or the water customer code, comma separated; the surest way to recognise its bills"
          >
            <input
              uiInput
              [value]="d.supplyCodes"
              (input)="patch({ supplyCodes: value($event) })"
            />
          </ui-form-field>
          <ui-form-field label="Notes">
            <textarea
              uiInput
              [value]="d.notes"
              (input)="patch({ notes: value($event) })"
            ></textarea>
          </ui-form-field>
          <div class="actions">
            <button
              uiButton
              variant="secondary"
              type="button"
              (click)="draft.set(null)"
            >
              Cancel
            </button>
            <button
              uiButton
              type="submit"
              [loading]="saving()"
              [disabled]="!d.name.trim()"
            >
              {{ d.id ? 'Save' : 'Add home' }}
            </button>
          </div>
        </form>
      } @else {
        <ul class="list" role="list">
          @for (p of store.properties() ?? []; track p.id) {
            <li class="item">
              <span
                class="swatch"
                [style.background]="color(p.colorSlot)"
              ></span>
              <div class="item__text">
                <strong>{{ p.name }}</strong>
                <span class="muted">
                  {{ addressOf(p) || 'No address yet' }}
                  · {{ p.supplyCodes.length }} supply
                  {{ p.supplyCodes.length === 1 ? 'code' : 'codes' }}
                </span>
              </div>
              <button
                uiButton
                variant="ghost"
                size="sm"
                type="button"
                (click)="edit(p)"
              >
                <ui-icon name="edit" [size]="16" /> Edit
              </button>
              <button
                uiButton
                variant="ghost"
                size="sm"
                [iconOnly]="true"
                type="button"
                [attr.aria-label]="'Delete ' + p.name"
                (click)="removing.set(p)"
              >
                <ui-icon name="trash" [size]="16" />
              </button>
            </li>
          }
        </ul>
        <button uiButton variant="secondary" type="button" (click)="add()">
          <ui-icon name="plus" [size]="16" /> Add a home
        </button>
      }
    </ui-dialog>

    <ui-confirm-dialog
      [open]="removing() !== null"
      (openChange)="$event || removing.set(null)"
      heading="Delete this home?"
      confirmLabel="Delete"
      tone="danger"
      [busy]="saving()"
      (confirmed)="remove()"
    >
      {{ removing()?.name }} and its renovations and repairs will be deleted.
      Its bills stay in your documents and go back to unassigned.
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
    .row {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(12rem, 1fr));
      gap: var(--space-4);
    }
    .actions {
      display: flex;
      justify-content: flex-end;
      gap: var(--space-2);
    }
    .list {
      display: grid;
      gap: var(--space-2);
      margin: 0 0 var(--space-4);
      padding: 0;
      list-style: none;
    }
    .item {
      display: flex;
      align-items: center;
      gap: var(--space-3);
      padding: var(--space-3);
      border: 1px solid var(--border-subtle);
      border-radius: var(--radius-md);
    }
    .item__text {
      display: grid;
      flex: 1;
      min-width: 0;
    }
    .swatch {
      width: var(--space-4);
      height: var(--space-4);
      border-radius: var(--radius-sm);
    }
    .muted {
      color: var(--text-muted);
      font-size: var(--text-sm);
    }
  `,
})
export class PropertiesDialog {
  private readonly api = inject(HomeApi);
  protected readonly store = inject(PropertyStore);

  readonly open = model(false);

  protected readonly draft = signal<Draft | null>(null);
  protected readonly removing = signal<PropertyDto | null>(null);
  protected readonly saving = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly color = propertyColor;
  protected readonly addressOf = addressOf;

  protected value(event: Event): string {
    return (event.target as HTMLInputElement).value;
  }

  protected patch(changes: Partial<Draft>): void {
    this.draft.update((d) => (d ? { ...d, ...changes } : d));
  }

  protected add(): void {
    this.draft.set({
      id: null,
      name: '',
      address: '',
      city: '',
      matchTerms: '',
      supplyCodes: '',
      notes: '',
    });
  }

  protected edit(p: PropertyDto): void {
    this.draft.set({
      id: p.id,
      name: p.name,
      address: p.address ?? '',
      city: p.city ?? '',
      matchTerms: p.matchTerms.join(', '),
      supplyCodes: p.supplyCodes.join(', '),
      notes: p.notes ?? '',
    });
  }

  protected save(d: Draft): void {
    const request = {
      name: d.name.trim(),
      address: d.address.trim() || null,
      city: d.city.trim() || null,
      supplyCodes: list(d.supplyCodes),
      notes: d.notes.trim() || null,
      // Empty on a new home: the service derives them from the name.
      ...(d.id || d.matchTerms.trim()
        ? { matchTerms: list(d.matchTerms) }
        : {}),
    };
    this.saving.set(true);
    const call = d.id
      ? this.api.updateProperty(d.id, request)
      : this.api.createProperty(request);
    call.subscribe({
      next: () => this.done(),
      error: (error) => this.fail(error),
    });
  }

  protected remove(): void {
    const property = this.removing();
    if (!property) return;
    this.saving.set(true);
    this.api.deleteProperty(property.id).subscribe({
      next: () => {
        this.removing.set(null);
        this.done();
      },
      error: (error) => this.fail(error),
    });
  }

  private done(): void {
    this.saving.set(false);
    this.error.set(null);
    this.draft.set(null);
    this.store.reload();
  }

  private fail(error: unknown): void {
    this.saving.set(false);
    this.error.set(errorMessage(error));
  }
}
