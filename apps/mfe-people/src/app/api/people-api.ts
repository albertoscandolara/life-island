import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import type {
  ApproveReviewRequest,
  MarkDocumentRequest,
  PeopleOverviewDto,
  UpdatePersonRequest,
} from '@life-island/contracts';
import type { Observable } from 'rxjs';

export const PEOPLE_API = '/api/people';

/** Client for svc-people, the only service this module talks to (through the gateway). */
@Injectable({ providedIn: 'root' })
export class PeopleApi {
  private readonly http = inject(HttpClient);

  overview(): Observable<PeopleOverviewDto> {
    return this.http.get<PeopleOverviewDto>(`${PEOPLE_API}/overview`);
  }

  approve(uploadId: string, request: ApproveReviewRequest): Observable<void> {
    return this.http.post<void>(
      `${PEOPLE_API}/reviews/${uploadId}/approve`,
      request,
    );
  }

  reject(uploadId: string): Observable<void> {
    return this.http.post<void>(`${PEOPLE_API}/reviews/${uploadId}/reject`, {});
  }

  reopen(uploadId: string): Observable<void> {
    return this.http.post<void>(`${PEOPLE_API}/reviews/${uploadId}/reopen`, {});
  }

  mark(uploadId: string, request: MarkDocumentRequest): Observable<void> {
    return this.http.patch<void>(
      `${PEOPLE_API}/documents/${uploadId}`,
      request,
    );
  }

  updatePerson(id: string, request: UpdatePersonRequest): Observable<void> {
    return this.http.patch<void>(`${PEOPLE_API}/people/${id}`, request);
  }

  previewUrl(uploadId: string): string {
    return `${PEOPLE_API}/documents/${uploadId}/preview`;
  }
}
