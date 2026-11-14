import { Injectable } from '@angular/core';
import type {
  DreamCheckInRequest,
  DreamContextDto,
  DreamDto,
  DreamsOverviewDto,
  DreamStepStatus,
  DreamSuggestRequest,
} from '@life-island/contracts';
import { RecordsApi } from '@life-island/records-ui';
import type { Observable } from 'rxjs';

/** Client for svc-dreams, the only service this module talks to (through the gateway). */
@Injectable({ providedIn: 'root' })
export class DreamsApi extends RecordsApi {
  constructor() {
    super('/api/dreams');
  }

  overview(): Observable<DreamsOverviewDto> {
    return this.http.get<DreamsOverviewDto>(`${this.base}/overview`);
  }

  context(dreamId: string): Observable<DreamContextDto> {
    return this.http.get<DreamContextDto>(
      `${this.base}/dreams/${dreamId}/context`,
    );
  }

  askQuestions(dreamId: string): Observable<DreamDto> {
    return this.http.post<DreamDto>(
      `${this.base}/dreams/${dreamId}/questions`,
      {},
    );
  }

  answer(questionId: string, answer: string | null): Observable<void> {
    return this.http.put<void>(`${this.base}/questions/${questionId}`, {
      answer,
    });
  }

  suggest(dreamId: string, request: DreamSuggestRequest): Observable<DreamDto> {
    return this.http.post<DreamDto>(
      `${this.base}/dreams/${dreamId}/suggestions`,
      request,
    );
  }

  setStepStatus(stepId: string, status: DreamStepStatus): Observable<void> {
    return this.http.put<void>(`${this.base}/steps/${stepId}/status`, {
      status,
    });
  }

  checkIn(request: DreamCheckInRequest): Observable<void> {
    return this.http.post<void>(`${this.base}/check-ins`, request);
  }

  removeCheckIn(id: string): Observable<void> {
    return this.http.delete<void>(`${this.base}/check-ins/${id}`);
  }
}
