import {
  HttpClient,
  HttpEventType,
  HttpHeaders,
  HttpRequest,
} from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import type {
  ApproveSuggestionRequest,
  ApproveSuggestionsRequest,
  ReclassificationStateDto,
  CategoryDto,
  CategorySuggestionDto,
  CompleteUploadResponse,
  CreateCategoryRequest,
  CreateUploadRequest,
  CreateUploadResponse,
  DeleteCategoryQuery,
  Page,
  ParseQueueDto,
  ReparseUploadsResponse,
  SuggestionStatus,
  UpdateCategoryRequest,
  UpdateSuggestionRequest,
  UpdateUploadRequest,
  UploadDto,
} from '@life-island/contracts';
import { filter, map, type Observable } from 'rxjs';

export const INGESTION_API = '/api/ingestion';

export type PutProgress =
  { type: 'progress'; percent: number } | { type: 'done' };

/** Client for svc-ingestion, reached through the gateway at /api/ingestion. */
@Injectable({ providedIn: 'root' })
export class IngestionApi {
  private readonly http = inject(HttpClient);

  createUpload(request: CreateUploadRequest): Observable<CreateUploadResponse> {
    return this.http.post<CreateUploadResponse>(
      `${INGESTION_API}/uploads`,
      request,
    );
  }

  /** PUTs the file straight to object storage with the presigned URL, reporting progress. */
  putFile(target: CreateUploadResponse, file: Blob): Observable<PutProgress> {
    const request = new HttpRequest('PUT', target.uploadUrl, file, {
      reportProgress: true,
      headers: new HttpHeaders(target.uploadHeaders),
    });
    return this.http.request(request).pipe(
      filter(
        (event) =>
          event.type === HttpEventType.UploadProgress ||
          event.type === HttpEventType.Response,
      ),
      map((event): PutProgress =>
        event.type === HttpEventType.UploadProgress
          ? {
              type: 'progress',
              percent: event.total
                ? Math.round((100 * event.loaded) / event.total)
                : 0,
            }
          : { type: 'done' },
      ),
    );
  }

  complete(uploadId: string): Observable<CompleteUploadResponse> {
    return this.http.post<CompleteUploadResponse>(
      `${INGESTION_API}/uploads/${uploadId}/complete`,
      {},
    );
  }

  list(limit = 20, offset = 0): Observable<Page<UploadDto>> {
    return this.http.get<Page<UploadDto>>(`${INGESTION_API}/uploads`, {
      params: { limit, offset },
    });
  }

  get(uploadId: string): Observable<UploadDto> {
    return this.http.get<UploadDto>(`${INGESTION_API}/uploads/${uploadId}`);
  }

  /** Your edits to a document: title, description, categories, field values. */
  updateUpload(
    uploadId: string,
    changes: UpdateUploadRequest,
  ): Observable<UploadDto> {
    return this.http.patch<UploadDto>(
      `${INGESTION_API}/uploads/${uploadId}`,
      changes,
    );
  }

  /** The document categories, with their extraction templates. */
  categories(): Observable<CategoryDto[]> {
    return this.http.get<CategoryDto[]>(`${INGESTION_API}/categories`);
  }

  createCategory(category: CreateCategoryRequest): Observable<CategoryDto> {
    return this.http.post<CategoryDto>(`${INGESTION_API}/categories`, category);
  }

  updateCategory(
    id: string,
    changes: UpdateCategoryRequest,
  ): Observable<CategoryDto> {
    return this.http.patch<CategoryDto>(
      `${INGESTION_API}/categories/${id}`,
      changes,
    );
  }

  /**
   * Deletes a category. Its documents stay: they lose it, or get its parent.
   * A category with subcategories needs `children` (where they go).
   */
  deleteCategory(
    id: string,
    options: DeleteCategoryQuery = {},
  ): Observable<void> {
    const params: Record<string, string> = {};
    if (options.children) params['children'] = options.children;
    if (options.documents) params['documents'] = options.documents;
    return this.http.delete<void>(`${INGESTION_API}/categories/${id}`, {
      params,
    });
  }

  updateSuggestion(
    id: string,
    changes: UpdateSuggestionRequest,
  ): Observable<CategorySuggestionDto> {
    return this.http.patch<CategorySuggestionDto>(
      `${INGESTION_API}/category-suggestions/${id}`,
      changes,
    );
  }

  suggestions(
    query: { status?: SuggestionStatus; uploadId?: string } = {},
  ): Observable<CategorySuggestionDto[]> {
    return this.http.get<CategorySuggestionDto[]>(
      `${INGESTION_API}/category-suggestions`,
      { params: { ...query } },
    );
  }

  approveSuggestion(
    id: string,
    edits: ApproveSuggestionRequest = {},
  ): Observable<CategorySuggestionDto> {
    return this.http.post<CategorySuggestionDto>(
      `${INGESTION_API}/category-suggestions/${id}/approve`,
      edits,
    );
  }

  /**
   * Confirms several suggestions in one operation: the taxonomy version goes
   * up once, however many categories it confirms.
   */
  approveSuggestions(
    items: ApproveSuggestionsRequest['items'],
  ): Observable<CategorySuggestionDto[]> {
    return this.http.post<CategorySuggestionDto[]>(
      `${INGESTION_API}/category-suggestions/approve`,
      { items },
    );
  }

  rejectSuggestion(id: string): Observable<CategorySuggestionDto> {
    return this.http.post<CategorySuggestionDto>(
      `${INGESTION_API}/category-suggestions/${id}/reject`,
      {},
    );
  }

  /** Declines a suggestion for one document; it stays pending for the others. */
  dismissSuggestion(
    id: string,
    uploadId: string,
  ): Observable<CategorySuggestionDto> {
    return this.http.post<CategorySuggestionDto>(
      `${INGESTION_API}/category-suggestions/${id}/dismiss`,
      { uploadId },
    );
  }

  /** Deletes a document and its file; a module keeps what it already loaded. */
  deleteUpload(uploadId: string): Observable<void> {
    return this.http.delete<void>(`${INGESTION_API}/uploads/${uploadId}`);
  }

  /**
   * Sends parsed documents back to the parse queue: the AI reassigns their
   * categories and reads their fields again, from scratch.
   */
  reparseUploads(uploadIds: string[]): Observable<ReparseUploadsResponse> {
    return this.http.post<ReparseUploadsResponse>(
      `${INGESTION_API}/uploads/reparse`,
      { uploadIds },
    );
  }

  /** Parse now: the worker starts a run without waiting for its schedule. */
  runParseNow(): Observable<ParseQueueDto> {
    return this.http.post<ParseQueueDto>(
      `${INGESTION_API}/parse-queue/run`,
      {},
    );
  }

  /** Whether AI parsing is idle, running or paused, and until when. */
  parseQueue(): Observable<ParseQueueDto> {
    return this.http.get<ParseQueueDto>(`${INGESTION_API}/parse-queue`);
  }

  /** Historical reclassification: the lock, the last run, whether one can start. */
  reclassification(): Observable<ReclassificationStateDto> {
    return this.http.get<ReclassificationStateDto>(
      `${INGESTION_API}/reclassification`,
    );
  }

  /** Reclassify now: checks past documents against the categories confirmed since. */
  runReclassification(): Observable<ReclassificationStateDto> {
    return this.http.post<ReclassificationStateDto>(
      `${INGESTION_API}/reclassification/run`,
      {},
    );
  }

  /** Shows the file in the browser (redirects to a short-lived storage link). */
  previewUrl(uploadId: string): string {
    return `${INGESTION_API}/uploads/${uploadId}/preview`;
  }

  /** Saves the file under its original name. */
  downloadUrl(uploadId: string): string {
    return `${INGESTION_API}/uploads/${uploadId}/download`;
  }
}
