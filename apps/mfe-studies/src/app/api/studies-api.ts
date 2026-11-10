import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import type {
  CertificationRequest,
  CourseRequest,
  PathProgressRequest,
  StepProgressRequest,
  StudiesOverviewDto,
  StudyPlanDto,
  StudyPlanRequest,
  StudySessionRequest,
  TrainingPlatformRequest,
} from '@life-island/contracts';
import type { Observable } from 'rxjs';

export const STUDIES_API = '/api/studies';

/** Client for svc-studies, the only service this module talks to (through the gateway). */
@Injectable({ providedIn: 'root' })
export class StudiesApi {
  private readonly http = inject(HttpClient);

  overview(): Observable<StudiesOverviewDto> {
    return this.http.get<StudiesOverviewDto>(`${STUDIES_API}/overview`);
  }

  addPlatform(request: TrainingPlatformRequest): Observable<{ id: string }> {
    return this.http.post<{ id: string }>(`${STUDIES_API}/platforms`, request);
  }

  updatePlatform(
    id: string,
    request: TrainingPlatformRequest,
  ): Observable<void> {
    return this.http.put<void>(`${STUDIES_API}/platforms/${id}`, request);
  }

  platformOpened(id: string): Observable<void> {
    return this.http.post<void>(`${STUDIES_API}/platforms/${id}/opened`, {});
  }

  removePlatform(id: string): Observable<void> {
    return this.http.delete<void>(`${STUDIES_API}/platforms/${id}`);
  }

  addCourse(request: CourseRequest): Observable<{ id: string }> {
    return this.http.post<{ id: string }>(`${STUDIES_API}/courses`, request);
  }

  updateCourse(id: string, request: CourseRequest): Observable<void> {
    return this.http.put<void>(`${STUDIES_API}/courses/${id}`, request);
  }

  removeCourse(id: string): Observable<void> {
    return this.http.delete<void>(`${STUDIES_API}/courses/${id}`);
  }

  addCertification(request: CertificationRequest): Observable<{ id: string }> {
    return this.http.post<{ id: string }>(
      `${STUDIES_API}/certifications`,
      request,
    );
  }

  updateCertification(
    id: string,
    request: CertificationRequest,
  ): Observable<void> {
    return this.http.put<void>(`${STUDIES_API}/certifications/${id}`, request);
  }

  removeCertification(id: string): Observable<void> {
    return this.http.delete<void>(`${STUDIES_API}/certifications/${id}`);
  }

  addSession(request: StudySessionRequest): Observable<{ id: string }> {
    return this.http.post<{ id: string }>(`${STUDIES_API}/sessions`, request);
  }

  removeSession(id: string): Observable<void> {
    return this.http.delete<void>(`${STUDIES_API}/sessions/${id}`);
  }

  setPath(pathId: string, request: PathProgressRequest): Observable<void> {
    return this.http.put<void>(`${STUDIES_API}/paths/${pathId}`, request);
  }

  setStep(stepId: string, request: StepProgressRequest): Observable<void> {
    return this.http.put<void>(`${STUDIES_API}/steps/${stepId}`, request);
  }

  writePlan(request: StudyPlanRequest): Observable<StudyPlanDto> {
    return this.http.post<StudyPlanDto>(`${STUDIES_API}/plans`, request);
  }

  removePlan(id: string): Observable<void> {
    return this.http.delete<void>(`${STUDIES_API}/plans/${id}`);
  }
}
