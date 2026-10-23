import {
  ChangeDetectionStrategy,
  Component,
  Directive,
  input,
} from '@angular/core';

/** Styles a native input or textarea: `<input uiInput>`, `<textarea uiInput>`. */
@Directive({
  selector: 'input[uiInput], textarea[uiInput]',
  host: { class: 'ui-input' },
})
export class UiInput {}

/**
 * Label, control, hint and error in one block. Wraps its control in a
 * `<label>`, so clicking the label focuses it. Pass `count` and `max` to show
 * a character counter.
 */
@Component({
  selector: 'ui-form-field',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './form-field.html',
  styleUrl: './form-field.css',
})
export class UiFormField {
  readonly label = input.required<string>();
  readonly hint = input('');
  readonly error = input('');
  readonly count = input<number | null>(null);
  readonly max = input<number | null>(null);
}
