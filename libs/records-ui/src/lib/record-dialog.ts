import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  input,
  model,
  output,
  signal,
  untracked,
} from '@angular/core';
import { UiAlert, UiButton, UiDialog, UiIcon } from '@life-island/design-system';
import { numberOrNull } from './format';

export type LiFieldType =
  | 'text'
  | 'textarea'
  | 'number'
  | 'money'
  | 'date'
  | 'time'
  | 'select'
  | 'checkbox'
  | 'url';

export interface LiFieldOption {
  value: string;
  label: string;
}

/** One field of a record's form. */
export interface LiField {
  /** The request property it fills. */
  key: string;
  label: string;
  type: LiFieldType;
  required?: boolean;
  hint?: string;
  placeholder?: string;
  options?: readonly LiFieldOption[];
  /** A select that can stay empty (sent as null). */
  emptyLabel?: string;
  min?: number;
  max?: number;
  step?: number;
  /** Takes the whole row of the form. */
  wide?: boolean;
  /** Read-only when editing: an amount's account, a step's goal. */
  fixedOnEdit?: boolean;
}

/** Options from a label map: `{ monthly: 'Every month' }`. */
export function liOptions(
  labels: Readonly<Record<string, string>>,
): LiFieldOption[] {
  return Object.entries(labels).map(([value, label]) => ({ value, label }));
}

type Draft = Record<string, string | boolean>;

/**
 * The add-and-edit popup of every record-keeping area: a form drawn from field
 * definitions, checked before it is sent, with Delete (asked twice) when an
 * existing record is open. It emits clean values: empty text and empty
 * selects become null, numbers become numbers.
 *
 * ```html
 * <li-record-dialog [(open)]="editing" heading="Account" [fields]="fields"
 *   [value]="account()" [saving]="saving()" [error]="error()"
 *   (save)="save($event)" (remove)="remove()" />
 * ```
 */
@Component({
  selector: 'li-record-dialog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [UiAlert, UiButton, UiDialog, UiIcon],
  template: `
    <ui-dialog
      [(open)]="open"
      [heading]="(isEdit() ? 'Edit ' : 'Add ') + heading().toLowerCase()"
      [size]="size()"
      [dismissible]="!saving()"
    >
      @if (intro()) {
        <p class="intro">{{ intro() }}</p>
      }
      <form
        class="form"
        [id]="formId"
        novalidate
        (submit)="$event.preventDefault(); submit()"
      >
        @for (field of fields(); track field.key) {
          @let fixed = isEdit() && field.fixedOnEdit;
          @if (field.type === 'checkbox') {
            <label class="check" [class.wide]="field.wide">
              <input
                type="checkbox"
                [checked]="draft()[field.key] === true"
                [disabled]="fixed"
                (change)="set(field.key, $any($event.target).checked)"
              />
              <span>{{ field.label }}</span>
              @if (field.hint) {
                <small class="hint">{{ field.hint }}</small>
              }
            </label>
          } @else {
            <label
              class="field"
              [class.wide]="field.wide || field.type === 'textarea'"
            >
              <span class="label"
                >{{ field.label }}@if (field.required) {
                  <span aria-hidden="true"> *</span>
                }</span
              >
              @switch (field.type) {
                @case ('textarea') {
                  <textarea
                    class="ui-input"
                    rows="4"
                    [attr.placeholder]="field.placeholder ?? null"
                    [attr.aria-invalid]="!!errors()[field.key]"
                    [value]="text(field.key)"
                    [disabled]="fixed"
                    (input)="set(field.key, $any($event.target).value)"
                  ></textarea>
                }
                @case ('select') {
                  <select
                    class="ui-input"
                    [attr.aria-invalid]="!!errors()[field.key]"
                    [disabled]="fixed"
                    (change)="set(field.key, $any($event.target).value)"
                  >
                    @if (!field.required || !text(field.key)) {
                      <option value="" [selected]="!text(field.key)">
                        {{ field.emptyLabel ?? 'Choose…' }}
                      </option>
                    }
                    @for (option of field.options ?? []; track option.value) {
                      <option
                        [value]="option.value"
                        [selected]="text(field.key) === option.value"
                      >
                        {{ option.label }}
                      </option>
                    }
                  </select>
                }
                @default {
                  <input
                    class="ui-input"
                    [type]="inputType(field)"
                    [attr.inputmode]="
                      field.type === 'money' || field.type === 'number'
                        ? 'decimal'
                        : null
                    "
                    [attr.placeholder]="field.placeholder ?? null"
                    [attr.min]="field.min ?? null"
                    [attr.max]="field.max ?? null"
                    [attr.aria-invalid]="!!errors()[field.key]"
                    [value]="text(field.key)"
                    [disabled]="fixed"
                    (input)="set(field.key, $any($event.target).value)"
                  />
                }
              }
              @if (errors()[field.key]; as message) {
                <small class="error" role="alert">{{ message }}</small>
              } @else if (field.hint) {
                <small class="hint">{{ field.hint }}</small>
              }
            </label>
          }
        }
      </form>
      @if (error()) {
        <ui-alert tone="danger">{{ error() }}</ui-alert>
      }
      <div uiDialogFooter class="footer">
        @if (isEdit() && removable()) {
          @if (confirming()) {
            <span class="confirm">
              Delete for good?
              <button
                uiButton
                variant="danger"
                size="sm"
                type="button"
                [loading]="saving()"
                (click)="remove.emit()"
              >
                Yes, delete
              </button>
              <button
                uiButton
                variant="ghost"
                size="sm"
                type="button"
                (click)="confirming.set(false)"
              >
                Keep
              </button>
            </span>
          } @else {
            <button
              uiButton
              variant="ghost"
              type="button"
              class="delete"
              (click)="confirming.set(true)"
            >
              <ui-icon name="trash" [size]="16" /> Delete
            </button>
          }
        }
        <span class="spacer"></span>
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
          [attr.form]="formId"
          [loading]="saving()"
        >
          {{ isEdit() ? 'Save' : 'Add' }}
        </button>
      </div>
    </ui-dialog>
  `,
  styles: `
    .intro {
      margin: 0 0 var(--space-4);
      color: var(--text-secondary);
    }
    .form {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(min(100%, 13rem), 1fr));
      gap: var(--space-3) var(--space-4);
      margin-bottom: var(--space-3);
    }
    .field {
      display: grid;
      gap: var(--space-1);
      align-content: start;
      min-width: 0;
    }
    .label {
      color: var(--text-secondary);
      font-size: var(--text-xs);
      font-weight: 600;
    }
    .wide {
      grid-column: 1 / -1;
    }
    .check {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: var(--space-2);
      align-self: end;
      min-height: var(--control-height);
      font-size: var(--text-sm);
      cursor: pointer;
    }
    .check input {
      width: var(--space-4);
      height: var(--space-4);
      accent-color: var(--accent);
    }
    .check .hint {
      flex-basis: 100%;
    }
    .hint {
      color: var(--text-muted);
      font-size: var(--text-xs);
    }
    .error {
      color: var(--tone-danger);
      font-size: var(--text-xs);
      font-weight: 600;
    }
    .footer {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: var(--space-2);
      width: 100%;
    }
    .spacer {
      flex: 1;
    }
    .confirm {
      display: inline-flex;
      flex-wrap: wrap;
      align-items: center;
      gap: var(--space-2);
      color: var(--tone-danger);
      font-size: var(--text-sm);
      font-weight: 600;
    }
    .delete {
      color: var(--tone-danger);
    }
  `,
})
export class LiRecordDialog {
  readonly open = model(false);
  /** What one record is, e.g. "Account": the title says "Add account". */
  readonly heading = input.required<string>();
  readonly intro = input('');
  readonly fields = input.required<readonly LiField[]>();
  /** The record being edited (with an `id`), defaults for a new one, or null. */
  readonly value = input<Readonly<Record<string, unknown>> | null>(null);
  readonly saving = input(false);
  readonly error = input<string | null>(null);
  readonly removable = input(true);
  readonly size = input<'sm' | 'md' | 'lg'>('md');

  readonly save = output<Record<string, unknown>>();
  readonly remove = output<void>();

  private static next = 0;
  protected readonly formId = `li-record-form-${LiRecordDialog.next++}`;
  protected readonly draft = signal<Draft>({});
  protected readonly errors = signal<Record<string, string>>({});
  protected readonly confirming = signal(false);
  protected readonly isEdit = computed(() => !!this.value()?.['id']);

  constructor() {
    // A fresh form each time the popup opens.
    effect(() => {
      if (!this.open()) return;
      const value = this.value();
      const fields = this.fields();
      untracked(() => {
        this.draft.set(toDraft(fields, value));
        this.errors.set({});
        this.confirming.set(false);
      });
    });
  }

  protected text(key: string): string {
    const value = this.draft()[key];
    return typeof value === 'string' ? value : '';
  }

  protected set(key: string, value: string | boolean): void {
    this.draft.update((draft) => ({ ...draft, [key]: value }));
    if (this.errors()[key])
      this.errors.update((errors) => {
        const rest = { ...errors };
        delete rest[key];
        return rest;
      });
  }

  protected inputType(field: LiField): string {
    switch (field.type) {
      case 'date':
        return 'date';
      case 'time':
        return 'time';
      case 'url':
        return 'url';
      case 'number':
      case 'money':
        return 'text';
      default:
        return 'text';
    }
  }

  protected submit(): void {
    const { values, errors } = fromDraft(this.fields(), this.draft());
    this.errors.set(errors);
    if (Object.keys(errors).length) return;
    this.save.emit(values);
  }
}

function toDraft(
  fields: readonly LiField[],
  value: Readonly<Record<string, unknown>> | null,
): Draft {
  const draft: Draft = {};
  for (const field of fields) {
    const current = value?.[field.key];
    if (field.type === 'checkbox') draft[field.key] = current === true;
    else if (current === null || current === undefined) draft[field.key] = '';
    else if (typeof current === 'number')
      draft[field.key] =
        field.type === 'money'
          ? current.toFixed(2).replace('.', ',')
          : String(current).replace('.', ',');
    else draft[field.key] = String(current);
  }
  return draft;
}

/** The draft as request values, and what is wrong with it per field. */
export function fromDraft(
  fields: readonly LiField[],
  draft: Readonly<Draft>,
): { values: Record<string, unknown>; errors: Record<string, string> } {
  const values: Record<string, unknown> = {};
  const errors: Record<string, string> = {};
  for (const field of fields) {
    const raw = draft[field.key];
    if (field.type === 'checkbox') {
      values[field.key] = raw === true;
      continue;
    }
    const text = typeof raw === 'string' ? raw.trim() : '';
    if (!text) {
      if (field.required) errors[field.key] = 'Fill this in';
      values[field.key] = null;
      continue;
    }
    if (field.type === 'number' || field.type === 'money') {
      const n = numberOrNull(text);
      if (n === null) errors[field.key] = 'Write a number, e.g. 12,50';
      else if (field.min !== undefined && n < field.min)
        errors[field.key] = `At least ${field.min}`;
      else if (field.max !== undefined && n > field.max)
        errors[field.key] = `At most ${field.max}`;
      values[field.key] = n;
      continue;
    }
    if (field.type === 'url' && !/^https?:\/\//i.test(text)) {
      errors[field.key] = 'Start the link with https://';
    }
    values[field.key] = text;
  }
  return { values, errors };
}
