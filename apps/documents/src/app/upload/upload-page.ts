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
import { ActivatedRoute, RouterLink } from '@angular/router';
import {
  agendaArea,
  type CompleteUploadResponse,
  type CreateUploadResponse,
  type UploadDto,
} from '@life-island/contracts';
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
} from '@life-island/design-system';
import { firstValueFrom, last, tap, type Observable } from 'rxjs';
import { IngestionApi } from '../api/ingestion-api';
import { ReviewApi } from '../api/review-api';
import { ReclassificationState } from '../reclassification/reclassification-state';
import { PROCESSING_VIEW } from '../review/record-status';
import { CameraDialog } from './camera-dialog';
import { PreviewDialog } from './preview-dialog';
import { UploadItem } from './upload-item';

const PAGE_SIZE = 10;

function errorMessage(error: unknown): string {
  if (error instanceof HttpErrorResponse) {
    // Checked first: on a network failure `error.error` is a TypeError whose
    // message ("Failed to fetch") says nothing useful.
    if (error.status === 0) return 'The server could not be reached';
    const body = error.error as {
      message?: string;
      issues?: { message: string }[];
    } | null;
    if (body?.issues?.length)
      return body.issues.map((issue) => issue.message).join(', ');
    if (typeof body?.message === 'string') return body.message;
    return `Upload failed (${error.status})`;
  }
  return error instanceof Error ? error.message : 'Upload failed';
}

/** No answer at all: storage down, unreachable, or refused by CORS. */
function isNetworkError(error: unknown): boolean {
  return error instanceof HttpErrorResponse && error.status === 0;
}

@Component({
  selector: 'app-upload-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CameraDialog,
    DatePipe,
    DecimalPipe,
    PreviewDialog,
    RouterLink,
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
  private readonly review = inject(ReviewApi);

  protected readonly accept = ACCEPTED_FILE_TYPES;
  protected readonly titleMax = TITLE_MAX_LENGTH;
  protected readonly descriptionMax = DESCRIPTION_MAX_LENGTH;
  protected readonly statusView = PROCESSING_VIEW;
  /** Category titles by id, for the badges; until they load, the ids show. */
  private readonly categories = rxResource({
    stream: () => this.api.categories(),
  });

  /**
   * Opened from a date's "Upload proof" (Needs you, the Agenda):
   * `?area=cars&for=Insurance · Panda&proof=the new insurance certificate`.
   * The page says what to load and where it goes next, and each file gets
   * "Proof for: …" as its description, so the reading knows what it is.
   */
  protected readonly proofFor = (() => {
    const query = inject(ActivatedRoute).snapshot.queryParamMap;
    const title = query.get('for')?.trim().slice(0, 200);
    const area = query.get('area')?.trim();
    if (!title || !area) return null;
    return {
      title,
      area: agendaArea(area).name,
      proof: query.get('proof')?.trim().slice(0, 120) || 'the document',
    };
  })();

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
  /** While a reclassification holds the lock, uploads wait. */
  protected readonly locked = inject(ReclassificationState).locked;
  protected readonly canUpload = computed(
    () =>
      !this.locked() &&
      !this.uploading() &&
      this.pending().length > 0 &&
      this.pending().every((item) => !item.invalidReason),
  );

  protected readonly page = signal(0);
  protected readonly pageSize = PAGE_SIZE;
  protected readonly documents = rxResource({
    params: () => this.page(),
    stream: ({ params: page }) => this.api.list(PAGE_SIZE, page * PAGE_SIZE),
  });
  protected readonly documentColumns: UiTableColumn[] = [
    { key: 'title', header: 'Title' },
    { key: 'fileFormat', header: 'Format', width: '5rem' },
    { key: 'status', header: 'Status', width: '12rem' },
    { key: 'categories', header: 'Categories', width: '10rem' },
    { key: 'uploadedAt', header: 'Uploaded', width: '10rem' },
    { key: 'parsedAt', header: 'Parsed', width: '10rem' },
    {
      key: 'actions',
      header: 'Preview and download',
      hideHeader: true,
      align: 'end',
      width: '6rem',
    },
  ];
  protected readonly documentRows = computed<UploadDto[]>(
    () => this.documents.value()?.items ?? [],
  );
  protected readonly documentTotal = computed(
    () => this.documents.value()?.total ?? null,
  );
  protected readonly previewing = signal<UploadDto | null>(null);
  /** The document whose file the person is picking again, for a retry. */
  private retrying: UploadDto | null = null;
  protected readonly previewOpen = signal(false);

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
      ...accepted.map((file) => {
        const item = new UploadItem(file);
        if (this.proofFor)
          item.description.set(
            `Proof for: ${this.proofFor.title}`.slice(
              0,
              DESCRIPTION_MAX_LENGTH,
            ),
          );
        return item;
      }),
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

  /**
   * Uploads the queue one file at a time: register, PUT to storage, complete.
   * A failed file is marked FAILED on the service at once, and retrying it
   * reuses the same document instead of leaving one stuck in "Uploading".
   */
  protected async uploadAll(): Promise<void> {
    this.uploading.set(true);
    for (const item of this.pending()) {
      item.state.set('uploading');
      item.progress.set(0);
      item.error.set('');
      try {
        const result = await this.send(item);
        item.progress.set(100);
        item.state.set(result.duplicate ? 'duplicate' : 'done');
        if (result.duplicate) await this.findOriginal(item, result.upload);
      } catch (error) {
        const message = errorMessage(error);
        item.state.set('error');
        item.error.set(message);
        const uploadId = item.uploadId();
        if (uploadId)
          await firstValueFrom(this.api.abandonUpload(uploadId, message)).catch(
            () => undefined,
          );
      }
    }
    this.uploading.set(false);
    this.documents.reload();
  }

  /**
   * "Already uploaded" says which document holds the file, and whether the
   * documents list has it: if it does not, you can replace it with this one.
   */
  private async findOriginal(
    item: UploadItem,
    original: UploadDto,
  ): Promise<void> {
    item.uploadId.set(null);
    item.original.set(original);
    item.originalListed.set(null);
    try {
      const page = await firstValueFrom(
        this.review.list({ uploadId: original.id, limit: 1 }),
      );
      item.originalListed.set(page.total > 0);
    } catch {
      // Unknown: offer the link only, never the replacement.
    }
  }

  /**
   * The earlier copy is missing from the documents list: delete it and send
   * this file again, so it gets a document you can find.
   */
  protected async replaceOriginal(item: UploadItem): Promise<void> {
    const original = item.original();
    if (!original) return;
    item.error.set('');
    try {
      await firstValueFrom(this.api.deleteUpload(original.id));
    } catch (error) {
      item.error.set(errorMessage(error));
      return;
    }
    item.original.set(null);
    item.originalListed.set(null);
    item.state.set('ready');
    await this.uploadAll();
  }

  private async send(item: UploadItem): Promise<CompleteUploadResponse> {
    const target = await this.uploadTarget(item);
    item.uploadId.set(target.uploadId);
    try {
      await this.withProgress(item, this.api.putFile(target, item.file));
    } catch (error) {
      if (!isNetworkError(error)) throw error;
      // The browser cannot reach storage (not running, or this page's origin
      // is missing from STORAGE_CORS_ORIGINS): send the file through the API.
      item.progress.set(0);
      await this.withProgress(
        item,
        this.api.putFileViaApi(target.uploadId, item.file),
      );
    }
    return firstValueFrom(this.api.complete(target.uploadId));
  }

  /** A new document, or a fresh URL for the one an earlier attempt created. */
  private async uploadTarget(item: UploadItem): Promise<CreateUploadResponse> {
    const existing = item.uploadId();
    if (existing) {
      try {
        return await firstValueFrom(this.api.restartUpload(existing));
      } catch (error) {
        // Deleted in the meantime: start over with a new document.
        if (!(error instanceof HttpErrorResponse && error.status === 404))
          throw error;
        item.uploadId.set(null);
      }
    }
    return firstValueFrom(
      this.api.createUpload({
        filename: item.file.name,
        mimeType: item.file.type || 'application/octet-stream',
        sizeBytes: item.file.size,
        title: item.title().trim(),
        description: item.description().trim() || undefined,
      }),
    );
  }

  private async withProgress(
    item: UploadItem,
    upload: Observable<
      { type: 'progress'; percent: number } | { type: 'done' }
    >,
  ): Promise<void> {
    await firstValueFrom(
      upload.pipe(
        tap(
          (event) =>
            event.type === 'progress' && item.progress.set(event.percent),
        ),
        last(),
      ),
    );
  }

  /** Documents whose file never arrived, which only a retry or a delete can fix. */
  protected needsFile(upload: UploadDto): boolean {
    if (upload.status === 'FAILED') return !upload.mimeType;
    return (
      upload.status === 'UPLOADING' &&
      !this.items().some(
        (item) => item.uploadId() === upload.id && item.state() === 'uploading',
      )
    );
  }

  /** Retrying a document without its file: the person picks the file again. */
  protected retryWithFile(upload: UploadDto, input: HTMLInputElement): void {
    this.retrying = upload;
    input.click();
  }

  protected onRetryPicked(input: HTMLInputElement): void {
    const upload = this.retrying;
    const file = input.files?.[0];
    input.value = '';
    this.retrying = null;
    if (!upload || !file) return;
    if (file.size > MAX_UPLOAD_BYTES) {
      this.notice.set(`${file.name} is larger than 25 MB`);
      return;
    }
    const item = new UploadItem(file);
    item.title.set(upload.title);
    item.description.set(upload.description ?? '');
    item.uploadId.set(upload.id);
    this.items()
      .filter((other) => other.uploadId() === upload.id)
      .forEach((other) => other.dispose());
    this.items.update((items) => [
      ...items.filter((other) => other.uploadId() !== upload.id),
      item,
    ]);
    if (!this.uploading() && !this.locked()) void this.uploadAll();
  }

  protected readonly deleting = signal<string | null>(null);

  /** Drops a document whose file never arrived; nothing else refers to it. */
  protected async deleteWithoutFile(upload: UploadDto): Promise<void> {
    this.deleting.set(upload.id);
    try {
      await firstValueFrom(this.api.deleteUpload(upload.id));
    } catch (error) {
      this.notice.set(errorMessage(error));
    }
    this.deleting.set(null);
    this.documents.reload();
  }

  /** Files exist in storage once the upload is complete, whatever happened after. */
  protected hasFile(upload: UploadDto): boolean {
    return upload.status !== 'UPLOADING' && upload.mimeType !== null;
  }

  protected preview(upload: UploadDto): void {
    this.previewing.set(upload);
    this.previewOpen.set(true);
  }

  protected downloadUrl(upload: UploadDto): string {
    return this.api.downloadUrl(upload.id);
  }

  protected categoryLabel(id: string): string {
    return (
      this.categories.value()?.find((category) => category.id === id)?.title ??
      id
    );
  }

  protected formatSize(bytes: number): number {
    return bytes / 1024 / 1024;
  }
}
