import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';

/**
 * Drop area for files: drag files onto it, or click / press Enter to open the
 * file picker. Projected content is the prompt; extra buttons (camera...) can
 * sit inside it and stop the click from reaching the zone.
 */
@Component({
  selector: 'ui-dropzone',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    role: 'button',
    tabindex: '0',
    '[attr.aria-label]': 'ariaLabel()',
    '[attr.aria-disabled]': 'disabled() || null',
    '[class.ui-dropzone--active]': 'dragging()',
    '(click)': 'browse()',
    '(keydown.enter)': 'browse()',
    '(keydown.space)': '$event.preventDefault(); browse()',
    '(dragenter)': 'onDragOver($event)',
    '(dragover)': 'onDragOver($event)',
    '(dragleave)': 'onDragLeave($event)',
    '(drop)': 'onDrop($event)',
  },
  template: `<ng-content />
    <input
      #picker
      type="file"
      hidden
      [attr.accept]="accept()"
      [multiple]="multiple()"
      (change)="onPicked(picker)"
      (click)="$event.stopPropagation()"
    />`,
  styles: `
    :host {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: var(--space-3);
      min-height: 12rem;
      padding: var(--space-8) var(--space-6);
      border: 2px dashed var(--border-strong);
      border-radius: var(--card-radius);
      background: var(--surface-card);
      color: var(--text-secondary);
      text-align: center;
      cursor: pointer;
      transition:
        border-color var(--duration-fast),
        background var(--duration-fast);
    }
    :host(:hover),
    :host(.ui-dropzone--active) {
      border-color: var(--accent);
      background: var(--accent-soft);
    }
    :host([aria-disabled='true']) {
      cursor: not-allowed;
      opacity: 0.6;
    }
  `,
})
export class UiDropzone {
  /** Same syntax as the `accept` attribute, e.g. `image/*,.pdf`. */
  readonly accept = input<string | null>(null);
  readonly multiple = input(true);
  readonly disabled = input(false);
  readonly ariaLabel = input('Drop files here or press Enter to choose files');
  readonly filesSelected = output<File[]>();

  protected readonly dragging = signal(false);
  private readonly picker =
    viewChild.required<ElementRef<HTMLInputElement>>('picker');

  browse(): void {
    if (!this.disabled()) this.picker().nativeElement.click();
  }

  protected onPicked(picker: HTMLInputElement): void {
    this.emit(picker.files);
    picker.value = '';
  }

  protected onDragOver(event: DragEvent): void {
    event.preventDefault();
    if (!this.disabled()) this.dragging.set(true);
  }

  protected onDragLeave(event: DragEvent): void {
    const host = event.currentTarget as HTMLElement;
    if (!host.contains(event.relatedTarget as Node | null))
      this.dragging.set(false);
  }

  protected onDrop(event: DragEvent): void {
    event.preventDefault();
    this.dragging.set(false);
    if (!this.disabled()) this.emit(event.dataTransfer?.files ?? null);
  }

  private emit(list: FileList | null): void {
    const files = Array.from(list ?? []);
    if (files.length)
      this.filesSelected.emit(this.multiple() ? files : files.slice(0, 1));
  }
}
