import {
  HttpClient,
  HttpEventType,
  HttpHeaders,
  HttpRequest,
} from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import type {
  ApproveSuggestionRequest,
  CategoryDto,
  CategorySuggestionDto,
  CompleteUploadResponse,
  CreateUploadRequest,
  CreateUploadResponse,
  Page,
  ParseQueueDto,
  SuggestionStatus,
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

  /** The document categories, with their extraction templates. */
  categories(): Observable<CategoryDto[]> {
    return this.http.get<CategoryDto[]>(`${INGESTION_API}/categories`);
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

  rejectSuggestion(id: string): Observable<CategorySuggestionDto> {
    return this.http.post<CategorySuggestionDto>(
      `${INGESTION_API}/category-suggestions/${id}/reject`,
      {},
    );
  }

  /** Whether AI parsing is idle, running or paused, and until when. */
  parseQueue(): Observable<ParseQueueDto> {
    return this.http.get<ParseQueueDto>(`${INGESTION_API}/parse-queue`);
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
