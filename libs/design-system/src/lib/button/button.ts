import { ChangeDetectionStrategy, Component, input } from '@angular/core';

export type UiButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type UiButtonSize = 'sm' | 'md';

/**
 * The one button of the platform, on a native `<button>` or `<a>` so focus,
 * keyboard and forms keep working: `<button uiButton variant="secondary">`.
 * `iconOnly` makes it square; give it an `aria-label`.
 */
@Component({
  // An attribute selector keeps the native element (and its semantics) in the DOM.
  // eslint-disable-next-line @angular-eslint/component-selector
  selector: 'button[uiButton], a[uiButton]',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'ui-button',
    '[class.ui-button--primary]': "variant() === 'primary'",
    '[class.ui-button--secondary]': "variant() === 'secondary'",
    '[class.ui-button--ghost]': "variant() === 'ghost'",
    '[class.ui-button--danger]': "variant() === 'danger'",
    '[class.ui-button--sm]': "size() === 'sm'",
    '[class.ui-button--icon]': 'iconOnly()',
    '[class.ui-button--loading]': 'loading()',
    '[attr.aria-busy]': 'loading() || null',
  },
  template: `@if (loading()) {
      <span class="ui-button__spinner" aria-hidden="true"></span>
    }
    <ng-content />`,
  styleUrl: './button.css',
})
export class UiButton {
  readonly variant = input<UiButtonVariant>('primary');
  readonly size = input<UiButtonSize>('md');
  readonly iconOnly = input(false);
  readonly loading = input(false);
}
