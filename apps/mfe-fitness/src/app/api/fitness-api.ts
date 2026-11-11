import { Injectable } from '@angular/core';
import type {
  FitnessOverviewDto,
  LifeQuestionRequest,
  TrainingPlanDto,
} from '@life-island/contracts';
import { RecordsApi } from '@life-island/records-ui';
import type { Observable } from 'rxjs';

/** Client for svc-fitness, the only service this module talks to (through the gateway). */
@Injectable({ providedIn: 'root' })
export class FitnessApi extends RecordsApi {
  constructor() {
    super('/api/fitness');
  }

  overview(): Observable<FitnessOverviewDto> {
    return this.http.get<FitnessOverviewDto>(`${this.base}/overview`);
  }

  plan(request: LifeQuestionRequest): Observable<TrainingPlanDto> {
    return this.http.post<TrainingPlanDto>(`${this.base}/plans`, request);
  }

  removePlan(id: string): Observable<void> {
    return this.http.delete<void>(`${this.base}/plans/${id}`);
  }
}
