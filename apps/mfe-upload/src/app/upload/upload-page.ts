import { DatePipe, DecimalPipe } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  ElementRef,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { rxResource } from '@angular/core/rxjs-interop';
import type { UploadDto, UploadStatus } from '@life-island/contracts';
import {
  ACCEPTED_FILE_TYPES,
  DESCRIPTION_MAX_LENGTH,
  MAX_UPLOAD_BYTES,
  TITLE_MAX_LENGTH,
} from '@life-island/contracts/constants';
import {
  UiAlert,
  UiBadge,
  UiButton,
  UiCard,
  UiCellDef,
  UiDropzone,
  UiFormField,
  UiIcon,
  UiInput,
  UiPageHeader,
  UiProgressBar,
  UiStatusDot,
  UiTable,
  type UiTableColumn,
  type UiTone,
} from '@life-island/design-system';
import { concatMap, firstValueFrom, last, tap } from 'rxjs';
import { IngestionApi } from '../api/ingestion-api';
import { CameraDialog } from './camera-dialog';
import { UploadItem } from './upload-item';

const STATUS_VIEW: Record<UploadStatus, { label: string; tone: UiTone }> = {
  UPLOADING: { label: 'Uploading', tone: 'info' },
  UPLOADED: { label: 'Waiting to be parsed', tone: 'neutral' },
  PARSING: { label: 'Parsing', tone: 'progress' },
  PARSED: { label: 'Parsed', tone: 'success' },
  FAILED: { label: 'Failed', tone: 'danger' },
};

function errorMessage(error: unknown): string {
  if (error instanceof HttpErrorResponse) {
    const body = error.error as {
      message?: string;
      issues?: { message: string }[];
    } | null;
    if (body?.issues?.length)
      return body.issues.map((issue) => issue.message).join(', ');
    if (typeof body?.message === 'string') return body.message;
    if (error.status === 0) return 'The server could not be reached';
    return `Upload failed (${error.status})`;
  }
  return error instanceof Error ? error.message : 'Upload failed';
}

@Component({
  selector: 'app-upload-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CameraDialog,
    DatePipe,
    DecimalPipe,
    UiAlert,
    UiBadge,
    UiButton,
    UiCard,
    UiCellDef,
    UiDropzone,
    UiFormField,
    UiIcon,
    UiInput,
    UiPageHeader,
    UiProgressBar,
    UiStatusDot,
    UiTable,
  ],
  templateUrl: './upload-page.html',
  styleUrl: './upload-page.css',
  host: { '(document:paste)': 'onPaste($event)' },
})
export class UploadPage {
  private readonly api = inject(IngestionApi);

  protected readonly accept = ACCEPTED_FILE_TYPES;
  protected readonly titleMax = TITLE_MAX_LENGTH;
  protected readonly descriptionMax = DESCRIPTION_MAX_LENGTH;
  protected readonly statusView = STATUS_VIEW;

  protected readonly items = signal<UploadItem[]>([]);
  protected readonly uploading = signal(false);
  protected readonly cameraOpen = signal(false);
  protected readonly notice = signal('');
  private readonly captureInput =
    viewChild.required<ElementRef<HTMLInputElement>>('captureInput');

  protected readonly pending = computed(() =>
    this.items().filter(
      (item) => item.state() === 'ready' || item.state() === 'error',
    ),
  );
  protected readonly canUpload = computed(
    () =>
      !this.uploading() &&
      this.pending().length > 0 &&
      this.pending().every((item) => !item.invalidReason),
  );

  protected readonly recent = rxResource({ stream: () => this.api.list(8) });
  protected readonly recentColumns: UiTableColumn[] = [
    { key: 'title', header: 'Title' },
    { key: 'fileFormat', header: 'Format', width: '6rem' },
    { key: 'status', header: 'Status', width: '12rem' },
    { key: 'uploadedAt', header: 'Uploaded', width: '11rem' },
    {
      key: 'file',
      header: 'Open file',
      hideHeader: true,
      align: 'end',
      width: '4rem',
    },
  ];
  protected readonly recentRows = computed<UploadDto[]>(
    () => this.recent.value()?.items ?? [],
  );

  constructor() {
    inject(DestroyRef).onDestroy(() =>
      this.items().forEach((item) => item.dispose()),
    );
  }

  protected addFiles(files: File[]): void {
    const rejected: string[] = [];
    const accepted = files.filter((file) => {
      if (file.size > MAX_UPLOAD_BYTES)
        rejected.push(`${file.name} is larger than 25 MB`);
      else if (file.size === 0) rejected.push(`${file.name} is empty`);
      else return true;
      return false;
    });
    this.notice.set(rejected.join('. '));
    this.items.update((items) => [
      ...items,
      ...accepted.map((file) => new UploadItem(file)),
    ]);
  }

  protected remove(item: UploadItem): void {
    item.dispose();
    this.items.update((items) => items.filter((other) => other !== item));
  }

  protected clearFinished(): void {
    this.items()
      .filter((item) => this.isFinished(item))
      .forEach((item) => item.dispose());
    this.items.update((items) =>
      items.filter((item) => !this.isFinished(item)),
    );
  }

  protected isFinished(item: UploadItem): boolean {
    return item.state() === 'done' || item.state() === 'duplicate';
  }

  protected openCamera(event: Event): void {
    event.stopPropagation();
    this.cameraOpen.set(true);
  }

  /** No camera API (or it failed): the native input opens the camera app on phones. */
  protected fallbackToCaptureInput(): void {
    this.captureInput().nativeElement.click();
  }

  protected onCapturePicked(input: HTMLInputElement): void {
    this.addFiles(Array.from(input.files ?? []));
    input.value = '';
  }

  /** Pasting an image or file anywhere on the page adds it to the queue. */
  protected onPaste(event: ClipboardEvent): void {
    const target = event.target as HTMLElement | null;
    if (target?.closest('input, textarea')) return;
    const files = Array.from(event.clipboardData?.files ?? []);
    if (files.length) this.addFiles(files);
  }

  /** Uploads the queue one file at a time: register, PUT to storage, complete. */
  protected async uploadAll(): Promise<void> {
    this.uploading.set(true);
    for (const item of this.pending()) {
      item.state.set('uploading');
      item.progress.set(0);
      item.error.set('');
      try {
        const result = await firstValueFrom(
          this.api
            .createUpload({
              filename: item.file.name,
              mimeType: item.file.type || 'application/octet-stream',
              sizeBytes: item.file.size,
              title: item.title().trim(),
              description: item.description().trim() || undefined,
            })
            .pipe(
              tap((created) => item.uploadId.set(created.uploadId)),
              concatMap((created) =>
                this.api.putFile(created, item.file).pipe(
                  tap(
                    (event) =>
                      event.type === 'progress' &&
                      item.progress.set(event.percent),
                  ),
                  last(),
                  concatMap(() => this.api.complete(created.uploadId)),
                ),
              ),
            ),
        );
        item.progress.set(100);
        item.state.set(result.duplicate ? 'duplicate' : 'done');
      } catch (error) {
        item.state.set('error');
        item.error.set(errorMessage(error));
      }
    }
    this.uploading.set(false);
    this.recent.reload();
  }

  protected fileUrl(upload: UploadDto): string {
    return this.api.fileUrl(upload.id);
  }

  protected formatSize(bytes: number): number {
    return bytes / 1024 / 1024;
  }
}
