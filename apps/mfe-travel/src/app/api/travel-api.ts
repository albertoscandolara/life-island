import { Injectable } from '@angular/core';
import type {
  ApplyTripPlanRequest,
  TravelOverviewDto,
  TripPlanDto,
  TripPlanRequest,
} from '@life-island/contracts';
import { RecordsApi } from '@life-island/records-ui';
import type { Observable } from 'rxjs';

/** Client for svc-travel, the only service this module talks to (through the gateway). */
@Injectable({ providedIn: 'root' })
export class TravelApi extends RecordsApi {
  constructor() {
    super('/api/travel');
  }

  overview(): Observable<TravelOverviewDto> {
    return this.http.get<TravelOverviewDto>(`${this.base}/overview`);
  }

  plan(tripId: string, request: TripPlanRequest): Observable<TripPlanDto> {
    return this.http.post<TripPlanDto>(
      `${this.base}/trips/${tripId}/plans`,
      request,
    );
  }

  applyPlan(
    id: string,
    request: ApplyTripPlanRequest,
  ): Observable<{ added: number }> {
    return this.http.post<{ added: number }>(
      `${this.base}/plans/${id}/apply`,
      request,
    );
  }

  removePlan(id: string): Observable<void> {
    return this.http.delete<void>(`${this.base}/plans/${id}`);
  }
}
