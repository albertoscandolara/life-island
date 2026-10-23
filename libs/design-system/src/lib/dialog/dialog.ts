import {
  ChangeDetectionStrategy,
  Component,
  effect,
  ElementRef,
  viewChild,
} from '@angular/core';
import { UiButton } from '../button/button';
import { UiIcon } from '../icon/icon';
import { UiDialogBase } from './dialog-base';

/**
 * The base popup, on the native `<dialog>` element: modal, focus-trapped,
 * closes on Escape and on a backdrop click. Body content is projected; put
 * actions in an element marked `uiDialogFooter`.
 *
 * ```html
 * <ui-dialog [(open)]="showHelp" heading="Help">
 *   <p>…</p>
 *   <div uiDialogFooter><button uiButton (click)="showHelp.set(false)">Got it</button></div>
 * </ui-dialog>
 * ```
 */
@Component({
  selector: 'ui-dialog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [UiButton, UiIcon],
  templateUrl: './dialog.html',
  styleUrl: './dialog.css',
})
export class UiDialog extends UiDialogBase {
  private readonly dialog =
    viewChild.required<ElementRef<HTMLDialogElement>>('dialog');

  constructor() {
    super();
    effect(() => {
      const element = this.dialog().nativeElement;
      if (this.open() && !element.open) element.showModal();
      if (!this.open() && element.open) element.close();
    });
  }

  protected onCancel(event: Event): void {
    event.preventDefault();
    if (this.dismissible()) this.close();
  }

  protected onClick(event: MouseEvent): void {
    // A click on the <dialog> itself (not its panel) is a click on the backdrop.
    if (event.target === this.dialog().nativeElement && this.dismissible())
      this.close();
  }
}
