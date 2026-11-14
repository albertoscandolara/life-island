import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  output,
} from '@angular/core';
import {
  FISCAL_CODE,
  TAX730_EXPENSE_TYPES,
  type DossierExpenseDto,
  type Tax730ExpenseType,
  type UpdateExpenseRequest,
} from '@life-island/contracts';
import { UiButton, UiFormField, UiInput } from '@life-island/design-system';
import { typeLabel } from './format';

/** "yes", "no" or "" (unknown) as the select holds it. */
const traceableValue = (value: boolean | null) =>
  value === null ? '' : value ? 'yes' : 'no';

/**
 * Corrects what was read from an expense's document: who issued it, its date
 * and amount, its type and 730 row, how it was paid and for whom. The date
 * stays in the expense's tax year.
 */
@Component({
  selector: 'tax-expense-edit',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [UiButton, UiFormField, UiInput],
  template: `
    @let e = expense();
    <form class="edit" (submit)="submit($event)">
      <div class="edit__grid">
        <ui-form-field label="Issuer (who was paid)">
          <input
            uiInput
            name="issuer"
            required
            maxlength="200"
            [value]="e.issuer"
          />
        </ui-form-field>
        <ui-form-field label="Invoice no.">
          <input
            uiInput
            name="documentNumber"
            maxlength="100"
            [value]="e.documentNumber ?? ''"
          />
        </ui-form-field>
        <ui-form-field label="Date">
          <input
            uiInput
            type="date"
            name="date"
            required
            [min]="e.taxYear + '-01-01'"
            [max]="e.taxYear + '-12-31'"
            [value]="e.date"
          />
        </ui-form-field>
        <ui-form-field label="Amount (€)">
          <input
            uiInput
            type="number"
            name="amount"
            required
            min="0.01"
            step="0.01"
            [value]="e.amount"
          />
        </ui-form-field>
        <ui-form-field label="Type">
          <select class="ui-input" name="expenseType">
            @for (type of types; track type) {
              <option [value]="type" [selected]="e.expenseType === type">
                {{ typeLabel(type) }}
              </option>
            }
          </select>
        </ui-form-field>
        <ui-form-field label="730 row" hint="e.g. E1, E41">
          <input
            uiInput
            name="frame730"
            maxlength="20"
            [value]="e.frame730 ?? ''"
          />
        </ui-form-field>
        <ui-form-field label="Paid traceably">
          <select class="ui-input" name="traceablePayment">
            @for (option of traceableOptions; track option.value) {
              <option
                [value]="option.value"
                [selected]="traceable() === option.value"
              >
                {{ option.label }}
              </option>
            }
          </select>
        </ui-form-field>
        <ui-form-field label="Beneficiary (codice fiscale)">
          <input
            uiInput
            name="beneficiaryFiscalCode"
            maxlength="20"
            autocapitalize="characters"
            [value]="e.beneficiaryFiscalCode ?? ''"
          />
        </ui-form-field>
      </div>
      <ui-form-field label="Description">
        <input
          uiInput
          name="description"
          maxlength="300"
          [value]="e.description ?? ''"
        />
      </ui-form-field>
      <ui-form-field label="Note">
        <input
          uiInput
          name="notes"
          maxlength="500"
          placeholder="e.g. payment proof on its way"
          [value]="e.notes ?? ''"
        />
      </ui-form-field>
      <div class="edit__actions">
        <button uiButton size="sm" type="submit" [disabled]="busy()">
          Save
        </button>
        <button
          uiButton
          variant="ghost"
          size="sm"
          type="button"
          (click)="cancelled.emit()"
        >
          Cancel
        </button>
      </div>
    </form>
  `,
  styles: `
    :host {
      display: block;
      min-width: 0;
    }
    .edit {
      display: grid;
      grid-template-columns: minmax(0, 1fr);
      gap: var(--space-3);
    }
    .edit__grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(min(100%, 12rem), 1fr));
      gap: var(--space-3);
    }
    select.ui-input {
      max-width: 100%;
    }
    .edit__actions {
      display: flex;
      flex-wrap: wrap;
      gap: var(--space-2);
    }
  `,
})
export class ExpenseEdit {
  readonly expense = input.required<DossierExpenseDto>();
  readonly busy = input(false);
  readonly saved = output<UpdateExpenseRequest>();
  readonly cancelled = output<void>();

  protected readonly types = TAX730_EXPENSE_TYPES;
  protected readonly typeLabel = typeLabel;
  protected readonly traceableOptions = [
    { value: '', label: 'Unknown' },
    { value: 'yes', label: 'Yes (card or transfer)' },
    { value: 'no', label: 'No (cash)' },
  ];
  protected readonly traceable = computed(() =>
    traceableValue(this.expense().traceablePayment),
  );

  protected submit(event: Event): void {
    event.preventDefault();
    const form = event.target as HTMLFormElement;
    if (!form.reportValidity()) return;
    const data = new FormData(form);
    const text = (name: string) => String(data.get(name) ?? '').trim();
    const fiscalCode = text('beneficiaryFiscalCode')
      .replace(/\s/g, '')
      .toUpperCase();
    const field = form.elements.namedItem(
      'beneficiaryFiscalCode',
    ) as HTMLInputElement | null;
    if (fiscalCode && !FISCAL_CODE.test(fiscalCode)) {
      field?.setCustomValidity('This is not a valid codice fiscale');
      field?.reportValidity();
      field?.addEventListener('input', () => field.setCustomValidity(''), {
        once: true,
      });
      return;
    }
    const traceable = text('traceablePayment');
    this.saved.emit({
      issuer: text('issuer'),
      documentNumber: text('documentNumber') || null,
      date: text('date'),
      amount: Number(text('amount')),
      expenseType: text('expenseType') as Tax730ExpenseType,
      frame730: text('frame730') || null,
      traceablePayment: traceable === '' ? null : traceable === 'yes',
      beneficiaryFiscalCode: fiscalCode || null,
      description: text('description') || null,
      notes: text('notes') || null,
    });
  }
}
