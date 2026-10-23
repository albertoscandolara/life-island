import {
  ChangeDetectionStrategy,
  Component,
  input,
  output,
} from '@angular/core';
import { UiButton } from '../button/button';
import { UiDialog } from './dialog';
import { UiDialogBase } from './dialog-base';

/**
 * A popup that asks for a decision. It extends the base popup class (same
 * `open`, `heading`, `size`, `dismissible`, `closed`) and renders inside
 * `ui-dialog`, adding Cancel and Confirm at the bottom.
 *
 * Confirm emits `confirmed` and leaves the dialog open, so the caller can show
 * `busy` while it saves and close it when done. Cancel, Escape and the
 * backdrop emit `cancelled` and close it.
 */
@Component({
  selector: 'ui-confirm-dialog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [UiButton, UiDialog],
  template: `
    <ui-dialog
      [open]="open()"
      (openChange)="$event ? open.set(true) : cancel()"
      [heading]="heading()"
      [size]="size()"
      [dismissible]="dismissible() && !busy()"
    >
      <ng-content />
      <div uiDialogFooter>
        <button
          uiButton
          variant="secondary"
          type="button"
          [disabled]="busy()"
          (click)="cancel()"
        >
          {{ cancelLabel() }}
        </button>
        <button
          uiButton
          type="button"
          [variant]="tone() === 'danger' ? 'danger' : 'primary'"
          [loading]="busy()"
          [disabled]="confirmDisabled() || busy()"
          (click)="confirmed.emit()"
        >
          {{ confirmLabel() }}
        </button>
      </div>
    </ui-dialog>
  `,
})
export class UiConfirmDialog extends UiDialogBase {
  readonly confirmLabel = input('Confirm');
  readonly cancelLabel = input('Cancel');
  readonly tone = input<'primary' | 'danger'>('primary');
  readonly busy = input(false);
  readonly confirmDisabled = input(false);

  readonly confirmed = output<void>();
  readonly cancelled = output<void>();

  protected cancel(): void {
    if (this.busy() || !this.open()) return;
    this.cancelled.emit();
    this.close();
  }
}
