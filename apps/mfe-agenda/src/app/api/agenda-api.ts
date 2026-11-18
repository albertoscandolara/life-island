import { Injectable } from '@angular/core';
import type {
  AgendaBriefDto,
  AgendaOverviewDto,
  DigestDto,
  DigestStatusDto,
  DigestTestDto,
  LifeQuestionRequest,
} from '@life-island/contracts';
import { RecordsApi } from '@life-island/records-ui';
import type { Observable } from 'rxjs';

/** Client for svc-agenda, the only service this module talks to (through the gateway). */
@Injectable({ providedIn: 'root' })
export class AgendaApi extends RecordsApi {
  constructor() {
    super('/api/agenda');
  }

  overview(): Observable<AgendaOverviewDto> {
    return this.http.get<AgendaOverviewDto>(`${this.base}/overview`);
  }

  setHandled(key: string, handled: boolean): Observable<void> {
    return this.http.put<void>(`${this.base}/handled`, { key, handled });
  }

  writeBrief(request: LifeQuestionRequest): Observable<AgendaBriefDto> {
    return this.http.post<AgendaBriefDto>(`${this.base}/briefs`, request);
  }

  removeBrief(id: string): Observable<void> {
    return this.http.delete<void>(`${this.base}/briefs/${id}`);
  }

  /** The email digest: how it is set and whether it can go. */
  digest(): Observable<DigestStatusDto> {
    return this.http.get<DigestStatusDto>(`${this.base}/digest`);
  }

  previewDigest(): Observable<DigestDto> {
    return this.http.get<DigestDto>(`${this.base}/digest/preview`);
  }

  testDigest(): Observable<DigestTestDto> {
    return this.http.post<DigestTestDto>(`${this.base}/digest/test`, {});
  }
}
