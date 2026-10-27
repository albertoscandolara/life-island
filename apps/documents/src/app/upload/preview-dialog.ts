import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  model,
} from '@angular/core';
import { DomSanitizer } from '@angular/platform-browser';
import type { UploadDto } from '@life-island/contracts';
import { PREVIEWABLE_FORMATS } from '@life-island/contracts/constants';
import {
  UiButton,
  UiDialog,
  UiEmptyState,
  UiIcon,
} from '@life-island/design-system';
import { IngestionApi } from '../api/ingestion-api';

/**
 * Shows an uploaded file without leaving the loader: images in an `<img>`,
 * PDF and text in a frame. Word and Excel cannot be shown by a browser, so
 * the dialog offers the download instead.
 */
@Component({
  selector: 'app-preview-dialog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [UiButton, UiDialog, UiEmptyState, UiIcon],
  template: `
    <ui-dialog [(open)]="open" [heading]="upload()?.title ?? ''" size="lg">
      @if (upload(); as file) {
        @switch (kind()) {
          @case ('image') {
            <img class="image" [src]="previewUrl()" [alt]="file.title" />
          }
          @case ('frame') {
            <iframe
              class="frame"
              [src]="frameUrl()"
              [title]="'Preview of ' + file.title"
            ></iframe>
          }
          @default {
            <ui-empty-state icon="file" heading="No preview for this format">
              <p class="hint">
                {{ file.fileFormat }} files cannot be shown in the browser.
                Download it to open it.
              </p>
            </ui-empty-state>
          }
        }
      }
      @if (upload(); as file) {
        <div uiDialogFooter class="footer">
          <span class="filename">{{ file.originalFilename }}</span>
          <a
            uiButton
            variant="secondary"
            [href]="previewUrl()"
            target="_blank"
            rel="noopener"
          >
            <ui-icon name="external" [size]="16" /> Open in a new tab
          </a>
          <a uiButton [href]="downloadUrl()" download>
            <ui-icon name="download" [size]="16" /> Download
          </a>
        </div>
      }
    </ui-dialog>
  `,
  styles: `
    .image {
      display: block;
      max-width: 100%;
      max-height: 70vh;
      margin: 0 auto;
      border-radius: var(--radius-sm);
    }

    .frame {
      width: 100%;
      height: 70vh;
      border: 1px solid var(--border-subtle);
      border-radius: var(--radius-sm);
      background: var(--surface-page);
    }

    .hint {
      margin: 0;
    }

    .footer {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: var(--space-2);
    }

    .filename {
      flex: 1;
      overflow: hidden;
      color: var(--text-muted);
      font-size: var(--text-sm);
      text-overflow: ellipsis;
      white-space: nowrap;
    }
  `,
})
export class PreviewDialog {
  private readonly api = inject(IngestionApi);
  private readonly sanitizer = inject(DomSanitizer);

  readonly open = model(false);
  readonly upload = input<UploadDto | null>(null);

  protected readonly kind = computed(() => {
    const format = this.upload()?.fileFormat;
    if (!format || !PREVIEWABLE_FORMATS.includes(format)) return 'none';
    return format === 'JPG' || format === 'PNG' || format === 'WEBP'
      ? 'image'
      : 'frame';
  });
  protected readonly previewUrl = computed(() => {
    const upload = this.upload();
    return upload ? this.api.previewUrl(upload.id) : '';
  });
  protected readonly downloadUrl = computed(() => {
    const upload = this.upload();
    return upload ? this.api.downloadUrl(upload.id) : '';
  });
  /** Our own API path, so it is safe to load in a frame. */
  protected readonly frameUrl = computed(() =>
    this.sanitizer.bypassSecurityTrustResourceUrl(this.previewUrl()),
  );
}
