import { signal } from '@angular/core';
import { errorText } from './format';
import type { RecordsApi } from './page-parts';

/**
 * The state behind one `li-record-dialog`: open it to add (with defaults) or
 * to edit a record, save or delete through the area's API, then tell the page
 * to reload.
 *
 * ```ts
 * readonly accounts = new RecordEditor(this.api, 'accounts', () => this.changed.emit(), 'svc-money');
 * ```
 * ```html
 * <li-record-dialog heading="Account" [fields]="fields" [(open)]="accounts.open"
 *   [value]="accounts.value()" [saving]="accounts.saving()" [error]="accounts.error()"
 *   (save)="accounts.save($event)" (remove)="accounts.remove()" />
 * ```
 */
export class RecordEditor {
  readonly open = signal(false);
  readonly value = signal<Record<string, unknown> | null>(null);
  readonly saving = signal(false);
  readonly error = signal<string | null>(null);

  constructor(
    private readonly api: RecordsApi,
    private readonly collection: string,
    private readonly done: () => void,
    private readonly service = 'The service',
    /** Keys carried from the record into the request though not in the form (a trip id). */
    private readonly keep: readonly string[] = [],
  ) {}

  add(defaults: Record<string, unknown> = {}): void {
    this.value.set({ ...defaults });
    this.error.set(null);
    this.open.set(true);
  }

  edit(record: object): void {
    this.value.set({ ...(record as Record<string, unknown>) });
    this.error.set(null);
    this.open.set(true);
  }

  save(values: Record<string, unknown>): void {
    const current = this.value() ?? {};
    const body: Record<string, unknown> = {};
    for (const key of this.keep)
      if (current[key] !== undefined) body[key] = current[key];
    Object.assign(body, values);
    this.saving.set(true);
    this.error.set(null);
    this.api
      .save(this.collection, current['id'] as string | undefined, body)
      .subscribe({
        next: () => {
          this.saving.set(false);
          this.open.set(false);
          this.done();
        },
        error: (error: unknown) => {
          this.saving.set(false);
          this.error.set(errorText(error, 'Could not save it.', this.service));
        },
      });
  }

  remove(): void {
    const id = this.value()?.['id'];
    if (typeof id !== 'string') return;
    this.saving.set(true);
    this.api.remove(this.collection, id).subscribe({
      next: () => {
        this.saving.set(false);
        this.open.set(false);
        this.done();
      },
      error: (error: unknown) => {
        this.saving.set(false);
        this.error.set(errorText(error, 'Could not delete it.', this.service));
      },
    });
  }
}
