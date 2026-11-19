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
  RECEIPT_CONTENT_TYPES,
  RECEIPT_MAX_FILES,
  type AccountDto,
  type MoneyCategory,
  type MoneyChannel,
  type MovementAttachmentDto,
  type ReceiptReadingOutput,
  type TransactionDto,
} from '@life-island/contracts';
import {
  UiAiPanel,
  UiAiStatus,
  UiAlert,
  UiButton,
  UiDialog,
  UiIcon,
} from '@life-island/design-system';
import { dateText, errorText, euro, localToday } from '@life-island/records-ui';
import { AiTool } from '@life-island/settings-ui';
import { map, type Observable } from 'rxjs';
import { MoneyApi } from '../api/money-api';
import {
  detailsRequest,
  emptyForm,
  formOf,
  formProblem,
  newMovementRequest,
  restOf,
  withReading,
  type ReceiptForm,
} from './receipt-form';

const SERVICE = 'svc-money';

/** The categories a purchase can be in (never salary, income or savings). */
const CATEGORY_OPTIONS = (
  Object.entries(MONEY_CATEGORY_LABELS) as [MoneyCategory, string][]
)
  .filter(([id]) => !['salary', 'other-income', 'savings'].includes(id))
  .map(([value, label]) => ({ value, label }));

/**
 * Receipts and a note for a movement, or a new expense from a receipt (cash
 * or a card not imported yet). The receipt reader (money.receipt-reader)
 * fills the category, the parts in other categories, online or in a shop and
 * a note of what was bought; you check it before saving. The files are filed
 * as documents, so they show in Documents too.
 */
@Component({
  selector: 'money-receipt',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [AiTool, UiAiPanel, UiAiStatus, UiAlert, UiButton, UiDialog, UiIcon],
  templateUrl: './money-receipt.html',
  styleUrl: './money-receipt.css',
})
export class MoneyReceipt {
  private readonly api = inject(MoneyApi);

  readonly open = model(false);
  /** The movement to add receipts to; null for a new expense. */
  readonly movement = input<TransactionDto | null>(null);
  readonly accounts = input<readonly AccountDto[]>([]);
  /** Whether the receipt reader calls the model now. */
  readonly aiOn = input(false);
  readonly saved = output<void>();

  protected readonly euro = euro;
  protected readonly dateText = dateText;
  protected readonly categories = CATEGORY_OPTIONS;
  protected readonly channels = Object.entries(MONEY_CHANNEL_LABELS) as [
    MoneyChannel,
    string,
  ][];
  protected readonly accept = RECEIPT_CONTENT_TYPES.join(',');
  protected readonly maxFiles = RECEIPT_MAX_FILES;

  protected readonly form = signal<ReceiptForm>(emptyForm([], localToday()));
  /** Files picked here, sent when you save. */
  protected readonly pending = signal<File[]>([]);
  /** Receipts already filed with the movement. */
  protected readonly filed = signal<MovementAttachmentDto[]>([]);
  protected readonly reading = signal<ReceiptReadingOutput | null>(null);
  protected readonly readState = signal<'idle' | 'working' | 'done' | 'error'>(
    'idle',
  );
  protected readonly readError = signal<string | null>(null);
  protected readonly saving = signal(false);
  /** A new expense already created by an earlier save. */
  private readonly createdId = signal<string | null>(null);
  protected readonly error = signal<string | null>(null);

  protected readonly isNew = computed(() => !this.movement());
  protected readonly heading = computed(() =>
    this.isNew() ? 'Add an expense from a receipt' : 'Receipt and note',
  );
  protected readonly openAccounts = computed(() =>
    this.accounts().filter((a) => !a.archived),
  );
  protected readonly rest = computed(() => restOf(this.form()));
  protected readonly problem = computed(() =>
    formProblem(this.form(), this.isNew()),
  );
  protected readonly canRead = computed(
    () =>
      this.aiOn() &&
      (this.pending().length > 0 || this.filed().length > 0) &&
      this.readState() !== 'working',
  );
  protected readonly tooMany = computed(
    () => this.pending().length > RECEIPT_MAX_FILES,
  );

  constructor() {
    // Each opening starts from the movement as it is (or an empty expense).
    effect(() => {
      if (!this.open()) return;
      const movement = this.movement();
      untracked(() => {
        this.form.set(
          movement
            ? formOf(movement)
            : emptyForm(this.accounts(), localToday()),
        );
        this.filed.set(movement?.attachments ?? []);
        this.pending.set([]);
        this.createdId.set(null);
        this.reading.set(null);
        this.readState.set('idle');
        this.readError.set(null);
        this.error.set(null);
      });
    });
  }

  protected set<K extends keyof ReceiptForm>(key: K, value: ReceiptForm[K]) {
    this.form.update((f) => ({ ...f, [key]: value }));
  }

  protected number(value: string): number | null {
    const n = Number(value.replace(',', '.'));
    return value.trim() && Number.isFinite(n) ? Math.abs(n) : null;
  }

  protected pick(event: Event): void {
    const target = event.target as HTMLInputElement;
    const picked = [...(target.files ?? [])];
    this.pending.update((files) => [...files, ...picked]);
    target.value = '';
  }

  protected drop(file: File): void {
    this.pending.update((files) => files.filter((f) => f !== file));
  }

  protected size(bytes: number): string {
    return bytes > 1024 * 1024
      ? `${(bytes / 1024 / 1024).toFixed(1)} MB`
      : `${Math.max(1, Math.round(bytes / 1024))} KB`;
  }

  protected previewUrl(a: MovementAttachmentDto): string {
    return this.api.previewUrl(a.id);
  }

  protected isImage(a: MovementAttachmentDto): boolean {
    return a.contentType.startsWith('image/');
  }

  protected detach(a: MovementAttachmentDto): void {
    const movement = this.movement();
    if (!movement) return;
    this.api.detach(movement.id, a.id).subscribe({
      next: () => {
        this.filed.update((list) => list.filter((x) => x.id !== a.id));
        this.saved.emit();
      },
      error: (error: unknown) =>
        this.error.set(errorText(error, 'Could not remove it.', SERVICE)),
    });
  }

  // Parts in other categories

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
    change: Partial<ReceiptForm['splits'][number]>,
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

  protected categoryLabel(c: MoneyCategory | null): string {
    return c ? MONEY_CATEGORY_LABELS[c] : 'its category';
  }

  // Reading and saving

  /** Reads the files picked here, else the ones already filed. */
  protected read(): void {
    const movement = this.movement();
    const pending = this.pending();
    if (pending.length > RECEIPT_MAX_FILES) return;
    this.readState.set('working');
    this.readError.set(null);
    const request = pending.length
      ? this.api.readReceipts(pending, this.form().notes.trim() || null)
      : this.api.readMovement(movement?.id ?? '');
    request.subscribe({
      next: ({ reading }) => {
        this.reading.set(reading);
        this.form.set(withReading(this.form(), reading, this.isNew()));
        this.readState.set('done');
      },
      error: (error: unknown) => {
        this.readState.set('error');
        this.readError.set(
          errorText(error, 'The receipt could not be read.', SERVICE),
        );
      },
    });
  }

  protected save(): void {
    if (this.problem() || this.tooMany()) return;
    const form = this.form();
    // A new expense saved once (its files failed) is changed, not added again.
    const id = this.movement()?.id ?? this.createdId();
    const files = this.pending();
    this.saving.set(true);
    this.error.set(null);
    const write: Observable<string> = id
      ? this.api
          .update('transactions', id, detailsRequest(form))
          .pipe(map(() => id))
      : this.api
          .create('transactions', newMovementRequest(form))
          .pipe(map((created) => created.id));
    write.subscribe({
      next: (savedId) => {
        this.createdId.set(savedId);
        if (!files.length) return this.done();
        this.api.attach(savedId, files).subscribe({
          next: () => this.done(),
          error: (error: unknown) => {
            this.saving.set(false);
            this.saved.emit();
            this.error.set(
              errorText(
                error,
                'The movement is saved, but the files were not: try again.',
                SERVICE,
              ),
            );
          },
        });
      },
      error: (error: unknown) => {
        this.saving.set(false);
        this.error.set(errorText(error, 'Could not save it.', SERVICE));
      },
    });
  }

  private done(): void {
    this.saving.set(false);
    this.open.set(false);
    this.saved.emit();
  }
}
