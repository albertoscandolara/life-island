import { Injectable } from '@angular/core';
import type {
  LifeQuestionRequest,
  RenewalAdviceDto,
  SubscriptionsOverviewDto,
} from '@life-island/contracts';
import { RecordsApi } from '@life-island/records-ui';
import type { Observable } from 'rxjs';

/** Client for svc-subscriptions, the only service this module talks to (through the gateway). */
@Injectable({ providedIn: 'root' })
export class SubscriptionsApi extends RecordsApi {
  constructor() {
    super('/api/subscriptions');
  }

  overview(): Observable<SubscriptionsOverviewDto> {
    return this.http.get<SubscriptionsOverviewDto>(`${this.base}/overview`);
  }

  advise(request: LifeQuestionRequest): Observable<RenewalAdviceDto> {
    return this.http.post<RenewalAdviceDto>(`${this.base}/advice`, request);
  }

  removeAdvice(id: string): Observable<void> {
    return this.http.delete<void>(`${this.base}/advice/${id}`);
  }
}
