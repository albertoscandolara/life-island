import { HttpClient, HttpParams } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import type {
  ListRecordsQuery,
  Page,
  RecordDetailDto,
  RecordDto,
  TargetCatalogEntryDto,
  UpdateRecordRequest,
} from '@life-island/contracts';
import type { Observable } from 'rxjs';

export const REVIEW_API = '/api/review';

/** Client for svc-review, reached through the gateway at /api/review. */
@Injectable({ providedIn: 'root' })
export class ReviewApi {
  private readonly http = inject(HttpClient);

  list(query: ListRecordsQuery): Observable<Page<RecordDto>> {
    let params = new HttpParams();
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== null && value !== '')
        params = params.set(key, String(value));
    }
    return this.http.get<Page<RecordDto>>(`${REVIEW_API}/records`, { params });
  }

  get(id: string): Observable<RecordDetailDto> {
    return this.http.get<RecordDetailDto>(`${REVIEW_API}/records/${id}`);
  }

  /** Saves your corrections to the details; Confirm then sends them. */
  update(
    id: string,
    changes: UpdateRecordRequest,
  ): Observable<RecordDetailDto> {
    return this.http.patch<RecordDetailDto>(
      `${REVIEW_API}/records/${id}`,
      changes,
    );
  }

  confirm(id: string): Observable<RecordDetailDto> {
    return this.http.post<RecordDetailDto>(
      `${REVIEW_API}/records/${id}/confirm`,
      {},
    );
  }

  catalog(): Observable<TargetCatalogEntryDto[]> {
    return this.http.get<TargetCatalogEntryDto[]>(`${REVIEW_API}/catalog`);
  }

  /**
   * Link to the original file. It is served by the ingestion service, which
   * owns the files; this is a plain link the browser follows, not an API call.
   */
  originalFileUrl(uploadId: string): string {
    return `/api/ingestion/uploads/${uploadId}/preview`;
  }
}
