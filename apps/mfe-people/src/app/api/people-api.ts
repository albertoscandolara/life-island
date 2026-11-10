import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import type {
  ApproveReviewRequest,
  MarkDocumentRequest,
  MergePeopleRequest,
  PeopleOverviewDto,
  ResidenceHousesDto,
  SetRelationRequest,
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

  /** Removes the person; their ID documents go back to review. */
  removePerson(id: string): Observable<void> {
    return this.http.delete<void>(`${PEOPLE_API}/people/${id}`);
  }

  /** Merges the duplicate `from` into this person. */
  mergePeople(id: string, request: MergePeopleRequest): Observable<void> {
    return this.http.post<void>(`${PEOPLE_API}/people/${id}/merge`, request);
  }

  /** Sets how another person is related to this one. */
  setRelation(id: string, request: SetRelationRequest): Observable<void> {
    return this.http.post<void>(
      `${PEOPLE_API}/people/${id}/relations`,
      request,
    );
  }

  removeRelation(id: string, otherId: string): Observable<void> {
    return this.http.delete<void>(
      `${PEOPLE_API}/people/${id}/relations/${otherId}`,
    );
  }

  /** The Home area's houses, read through svc-people. */
  residenceHouses(): Observable<ResidenceHousesDto> {
    return this.http.get<ResidenceHousesDto>(`${PEOPLE_API}/houses`);
  }

  previewUrl(uploadId: string): string {
    return `${PEOPLE_API}/documents/${uploadId}/preview`;
  }
}
