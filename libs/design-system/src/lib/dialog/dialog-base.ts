import { Directive, input, model, output } from '@angular/core';

export type UiDialogSize = 'sm' | 'md' | 'lg';

let nextId = 0;

/**
 * What every popup shares: two-way `open`, a heading, a size, whether Escape
 * and the backdrop close it, and the `closed` output. `ui-dialog` renders it;
 * `ui-confirm-dialog` and any future popup extend this class to keep the same API.
 */
@Directive()
export abstract class UiDialogBase {
  readonly open = model(false);
  readonly heading = input('');
  readonly size = input<UiDialogSize>('md');
  /** When false, Escape and backdrop clicks do nothing (e.g. while saving). */
  readonly dismissible = input(true);
  readonly closed = output<void>();

  protected readonly headingId = `ui-dialog-heading-${nextId++}`;

  close(): void {
    if (!this.open()) return;
    this.open.set(false);
    this.closed.emit();
  }
}
