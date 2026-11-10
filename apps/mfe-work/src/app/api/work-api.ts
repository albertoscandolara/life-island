import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import type {
  ApproveWorkReviewRequest,
  CareerEventRequest,
  CareerFeedbackDto,
  CreateWorkplaceRequest,
  GoalStatusRequest,
  HiringPlatformRequest,
  JobApplicationRequest,
  MarketCheckDto,
  MarketCheckRequest,
  UpdateWorkplaceRequest,
  WorkOverviewDto,
} from '@life-island/contracts';
import type { Observable } from 'rxjs';

export const WORK_API = '/api/work';

/** Client for svc-work, the only service this module talks to (through the gateway). */
@Injectable({ providedIn: 'root' })
export class WorkApi {
  private readonly http = inject(HttpClient);

  overview(): Observable<WorkOverviewDto> {
    return this.http.get<WorkOverviewDto>(`${WORK_API}/overview`);
  }

  approve(
    uploadId: string,
    request: ApproveWorkReviewRequest,
  ): Observable<void> {
    return this.http.post<void>(
      `${WORK_API}/reviews/${uploadId}/approve`,
      request,
    );
  }

  reject(uploadId: string): Observable<void> {
    return this.http.post<void>(`${WORK_API}/reviews/${uploadId}/reject`, {});
  }

  reopen(uploadId: string): Observable<void> {
    return this.http.post<void>(`${WORK_API}/reviews/${uploadId}/reopen`, {});
  }

  createWorkplace(request: CreateWorkplaceRequest): Observable<{ id: string }> {
    return this.http.post<{ id: string }>(`${WORK_API}/workplaces`, request);
  }

  updateWorkplace(
    id: string,
    request: UpdateWorkplaceRequest,
  ): Observable<void> {
    return this.http.patch<void>(`${WORK_API}/workplaces/${id}`, request);
  }

  /** Removes the workplace; its documents go back to review. */
  removeWorkplace(id: string): Observable<void> {
    return this.http.delete<void>(`${WORK_API}/workplaces/${id}`);
  }

  addEvent(request: CareerEventRequest): Observable<{ id: string }> {
    return this.http.post<{ id: string }>(`${WORK_API}/events`, request);
  }

  removeEvent(id: string): Observable<void> {
    return this.http.delete<void>(`${WORK_API}/events/${id}`);
  }

  addPlatform(request: HiringPlatformRequest): Observable<{ id: string }> {
    return this.http.post<{ id: string }>(`${WORK_API}/platforms`, request);
  }

  updatePlatform(id: string, request: HiringPlatformRequest): Observable<void> {
    return this.http.put<void>(`${WORK_API}/platforms/${id}`, request);
  }

  removePlatform(id: string): Observable<void> {
    return this.http.delete<void>(`${WORK_API}/platforms/${id}`);
  }

  askFeedback(question: string | null): Observable<CareerFeedbackDto> {
    return this.http.post<CareerFeedbackDto>(`${WORK_API}/feedback`, {
      question,
    });
  }

  removeFeedback(id: string): Observable<void> {
    return this.http.delete<void>(`${WORK_API}/feedback/${id}`);
  }

  /** Where a goal of an evaluation stands. */
  setGoalStatus(request: GoalStatusRequest): Observable<void> {
    return this.http.put<void>(`${WORK_API}/goals`, request);
  }

  /** Public salary ranges for your role, found on the web by Claude. */
  runMarketCheck(request: MarketCheckRequest): Observable<MarketCheckDto> {
    return this.http.post<MarketCheckDto>(`${WORK_API}/market-checks`, request);
  }

  removeMarketCheck(id: string): Observable<void> {
    return this.http.delete<void>(`${WORK_API}/market-checks/${id}`);
  }

  addApplication(request: JobApplicationRequest): Observable<{ id: string }> {
    return this.http.post<{ id: string }>(`${WORK_API}/applications`, request);
  }

  updateApplication(
    id: string,
    request: JobApplicationRequest,
  ): Observable<void> {
    return this.http.put<void>(`${WORK_API}/applications/${id}`, request);
  }

  removeApplication(id: string): Observable<void> {
    return this.http.delete<void>(`${WORK_API}/applications/${id}`);
  }

  previewUrl(uploadId: string): string {
    return `${WORK_API}/documents/${uploadId}/preview`;
  }
}
