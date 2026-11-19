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
  MONEY_CATEGORY_LABELS,
  MONEY_CHANNEL_LABELS,
  MAX_SPLITS,
  type MoneyCategory,
  type MoneyChannel,
  type MovementPaidItemDto,
  type TransactionDto,
} from '@life-island/contracts';
import {
  UiAlert,
  UiButton,
  UiDialog,
  UiIcon,
} from '@life-island/design-system';
import { dateText, errorText, euro } from '@life-island/records-ui';
import { DOCUMENTS_APP_URL } from '@life-island/settings-ui';
import { MoneyApi } from '../api/money-api';
import {
  detailsRequest,
  formOf,
  formProblem,
  restOf,
  type DetailsForm,
} from './details-form';

const SERVICE = 'svc-money';

/** The categories a purchase can be in (never salary, income or savings). */
const CATEGORY_OPTIONS = (
  Object.entries(MONEY_CATEGORY_LABELS) as [MoneyCategory, string][]
)
  .filter(([id]) => !['salary', 'other-income', 'savings'].includes(id))
  .map(([value, label]) => ({ value, label }));

/**
 * What a movement bought: a note, online or in a shop, and the parts in
 * other categories. A receipt or an order is never uploaded here: it goes
 * through the documents app like every file, and once you confirm it there
 * Money pairs it with the movement and fills these from its lines.
 */
@Component({
  selector: 'money-details',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [UiAlert, UiButton, UiDialog, UiIcon],
  templateUrl: './money-details.html',
  styleUrl: './money-details.css',
})
export class MoneyDetails {
  private readonly api = inject(MoneyApi);
  protected readonly documentsUrl = inject(DOCUMENTS_APP_URL);

  readonly open = model(false);
  readonly movement = input<TransactionDto | null>(null);
  /** What the movement paid in other areas: a receipt, a bill… */
  readonly paidItems = input<readonly MovementPaidItemDto[]>([]);
  readonly saved = output<void>();

  protected readonly euro = euro;
  protected readonly dateText = dateText;
  protected readonly categories = CATEGORY_OPTIONS;
  protected readonly channels = Object.entries(MONEY_CHANNEL_LABELS) as [
    MoneyChannel,
    string,
  ][];
  protected readonly maxSplits = MAX_SPLITS;

  protected readonly form = signal<DetailsForm>({
    paid: 0,
    category: 'other',
    channel: null,
    notes: '',
    splits: [],
  });
  protected readonly saving = signal(false);
  protected readonly error = signal<string | null>(null);

  protected readonly rest = computed(() => restOf(this.form()));
  protected readonly problem = computed(() => formProblem(this.form()));
  /** The receipts and orders linked to this movement. */
  protected readonly receipts = computed(() => {
    const id = this.movement()?.id;
    return this.paidItems().filter(
      (p) => p.movementId === id && p.module === 'groceries',
    );
  });

  constructor() {
    // Each opening starts from the movement as it is.
    effect(() => {
      if (!this.open()) return;
      const movement = this.movement();
      untracked(() => {
        if (movement) this.form.set(formOf(movement));
        this.error.set(null);
      });
    });
  }

  protected set<K extends keyof DetailsForm>(key: K, value: DetailsForm[K]) {
    this.form.update((f) => ({ ...f, [key]: value }));
  }

  protected number(value: string): number | null {
    const n = Number(value.replace(',', '.'));
    return value.trim() && Number.isFinite(n) ? Math.abs(n) : null;
  }

  protected addSplit(): void {
    const used = new Set([
      this.form().category,
      ...this.form().splits.map((s) => s.category),
    ]);
    const next =
      CATEGORY_OPTIONS.find((c) => !used.has(c.value))?.value ?? 'other';
    this.set('splits', [
      ...this.form().splits,
      { category: next, amount: null },
    ]);
  }

  protected setSplit(
    index: number,
    change: Partial<DetailsForm['splits'][number]>,
  ): void {
    this.set(
      'splits',
      this.form().splits.map((s, i) => (i === index ? { ...s, ...change } : s)),
    );
  }

  protected removeSplit(index: number): void {
    this.set(
      'splits',
      this.form().splits.filter((_, i) => i !== index),
    );
  }

  protected categoryLabel(c: MoneyCategory): string {
    return MONEY_CATEGORY_LABELS[c];
  }

  protected save(): void {
    const movement = this.movement();
    if (!movement || this.problem()) return;
    this.saving.set(true);
    this.error.set(null);
    this.api
      .update('transactions', movement.id, detailsRequest(this.form()))
      .subscribe({
        next: () => {
          this.saving.set(false);
          this.open.set(false);
          this.saved.emit();
        },
        error: (error: unknown) => {
          this.saving.set(false);
          this.error.set(errorText(error, 'Could not save it.', SERVICE));
        },
      });
  }
}
