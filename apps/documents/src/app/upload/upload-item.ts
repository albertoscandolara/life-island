import { signal } from '@angular/core';
import type { UploadDto } from '@life-island/contracts';
import {
  DESCRIPTION_MAX_LENGTH,
  TITLE_MAX_LENGTH,
} from '@life-island/contracts/constants';

export type UploadItemState =
  'ready' | 'uploading' | 'done' | 'duplicate' | 'error';

let nextId = 0;

export function defaultTitle(filename: string): string {
  return filename
    .replace(/\.[^.]+$/, '')
    .replace(/[_-]+/g, ' ')
    .trim()
    .slice(0, TITLE_MAX_LENGTH);
}

/** One file waiting in the queue, with the title and description the person types. */
export class UploadItem {
  readonly id = nextId++;
  readonly title;
  readonly description = signal('');
  readonly state = signal<UploadItemState>('ready');
  readonly progress = signal(0);
  readonly error = signal('');
  readonly uploadId = signal<string | null>(null);
  /** The document this same file was uploaded as before ("Already uploaded"). */
  readonly original = signal<UploadDto | null>(null);
  /**
   * Whether that earlier document is in the documents list: null while it is
   * checked (or if the check failed), false when the list has no record of it.
   */
  readonly originalListed = signal<boolean | null>(null);
  /** Object URL for image thumbnails; revoked when the item is removed. */
  readonly previewUrl: string | null;

  constructor(readonly file: File) {
    this.title = signal(defaultTitle(file.name));
    this.previewUrl = file.type.startsWith('image/')
      ? URL.createObjectURL(file)
      : null;
  }

  get invalidReason(): string {
    if (!this.title().trim()) return 'Add a title';
    if (this.title().length > TITLE_MAX_LENGTH)
      return `Title is longer than ${TITLE_MAX_LENGTH} characters`;
    if (this.description().length > DESCRIPTION_MAX_LENGTH) {
      return `Description is longer than ${DESCRIPTION_MAX_LENGTH} characters`;
    }
    return '';
  }

  dispose(): void {
    if (this.previewUrl) URL.revokeObjectURL(this.previewUrl);
  }
}
