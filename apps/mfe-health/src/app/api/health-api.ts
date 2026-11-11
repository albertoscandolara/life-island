import { Injectable } from '@angular/core';
import type {
  HealthOverviewDto,
  ResultsExplainRequest,
  ResultsExplanationDto,
} from '@life-island/contracts';
import { RecordsApi } from '@life-island/records-ui';
import type { Observable } from 'rxjs';

/** Client for svc-health, the only service this module talks to (through the gateway). */
@Injectable({ providedIn: 'root' })
export class HealthApi extends RecordsApi {
  constructor() {
    super('/api/health');
  }

  overview(): Observable<HealthOverviewDto> {
    return this.http.get<HealthOverviewDto>(`${this.base}/overview`);
  }

  explain(request: ResultsExplainRequest): Observable<ResultsExplanationDto> {
    return this.http.post<ResultsExplanationDto>(
      `${this.base}/explanations`,
      request,
    );
  }

  removeExplanation(id: string): Observable<void> {
    return this.http.delete<void>(`${this.base}/explanations/${id}`);
  }
}
