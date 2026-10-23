import {
  ChangeDetectionStrategy,
  Component,
  computed,
  ElementRef,
  inject,
  input,
  model,
  signal,
} from '@angular/core';
import { UiIcon } from '../icon/icon';
import type { UiTone } from '../status-dot/status-dot';
import { UiStatusDot } from '../status-dot/status-dot';

export interface UiOption<T> {
  value: T;
  label: string;
  /** Shows a coloured dot before the label. */
  tone?: UiTone;
}

let nextId = 0;

/**
 * A select with the platform's look: a button that opens a listbox.
 * Keyboard: Enter/Space/ArrowDown open it, arrows move, Enter picks,
 * Escape closes. `value` is a two-way model, so `[(value)]` works, and so do
 * Signal Forms (`FormValueControl`).
 */
@Component({
  selector: 'ui-dropdown',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [UiIcon, UiStatusDot],
  templateUrl: './dropdown.html',
  styleUrl: './dropdown.css',
  host: {
    '(document:click)': 'onDocumentClick($event)',
  },
})
export class UiDropdown<T> {
  readonly options = input.required<readonly UiOption<T>[]>();
  readonly value = model<T | null>(null);
  readonly placeholder = input('Select…');
  /** Accessible name when there is no visible label. */
  readonly ariaLabel = input<string | null>(null, { alias: 'aria-label' });
  /** Adds a first option that resets the value to null. */
  readonly clearable = input(false);
  readonly clearLabel = input('Any');
  readonly disabled = input(false);

  protected readonly listId = `ui-dropdown-${nextId++}`;
  protected readonly expanded = signal(false);
  protected readonly activeIndex = signal(-1);

  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  /** The options as listed, with the clear entry first when enabled. */
  protected readonly entries = computed<readonly UiOption<T | null>[]>(() =>
    this.clearable()
      ? [{ value: null, label: this.clearLabel() }, ...this.options()]
      : this.options(),
  );
  protected readonly selected = computed(() =>
    this.options().find((option) => option.value === this.value()),
  );

  protected toggle(): void {
    if (this.expanded()) this.collapse();
    else this.expand();
  }

  protected expand(): void {
    if (this.disabled()) return;
    const current = this.entries().findIndex(
      (option) => option.value === this.value(),
    );
    this.activeIndex.set(Math.max(0, current));
    this.expanded.set(true);
  }

  protected collapse(): void {
    this.expanded.set(false);
  }

  protected choose(option: UiOption<T | null>): void {
    this.value.set(option.value);
    this.collapse();
    this.host.nativeElement.querySelector<HTMLButtonElement>('button')?.focus();
  }

  protected onKeydown(event: KeyboardEvent): void {
    const count = this.entries().length;
    switch (event.key) {
      case 'ArrowDown':
      case 'ArrowUp': {
        event.preventDefault();
        if (!this.expanded()) return this.expand();
        const step = event.key === 'ArrowDown' ? 1 : -1;
        this.activeIndex.update((index) => (index + step + count) % count);
        return;
      }
      case 'Home':
      case 'End':
        if (!this.expanded()) return;
        event.preventDefault();
        this.activeIndex.set(event.key === 'Home' ? 0 : count - 1);
        return;
      case 'Enter':
      case ' ':
        event.preventDefault();
        if (!this.expanded()) return this.expand();
        if (this.entries()[this.activeIndex()])
          this.choose(this.entries()[this.activeIndex()]);
        return;
      case 'Escape':
      case 'Tab':
        if (this.expanded()) {
          if (event.key === 'Escape') event.preventDefault();
          this.collapse();
        }
        return;
    }
  }

  protected onDocumentClick(event: MouseEvent): void {
    if (
      this.expanded() &&
      !this.host.nativeElement.contains(event.target as Node)
    ) {
      this.collapse();
    }
  }
}
