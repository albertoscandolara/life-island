import { Injectable } from '@angular/core';
import type {
  GoalsCoachDto,
  GoalsOverviewDto,
  LifeQuestionRequest,
  WeeklyReviewRequest,
} from '@life-island/contracts';
import { RecordsApi } from '@life-island/records-ui';
import type { Observable } from 'rxjs';

/** Client for svc-goals, the only service this module talks to (through the gateway). */
@Injectable({ providedIn: 'root' })
export class GoalsApi extends RecordsApi {
  constructor() {
    super('/api/goals');
  }

  overview(): Observable<GoalsOverviewDto> {
    return this.http.get<GoalsOverviewDto>(`${this.base}/overview`);
  }

  checkHabit(id: string, date: string, done: boolean): Observable<void> {
    return this.http.put<void>(`${this.base}/habits/${id}/checks`, {
      date,
      done,
    });
  }

  saveWeeklyReview(request: WeeklyReviewRequest): Observable<void> {
    return this.http.put<void>(`${this.base}/weekly-reviews`, request);
  }

  coach(request: LifeQuestionRequest): Observable<GoalsCoachDto> {
    return this.http.post<GoalsCoachDto>(`${this.base}/advice`, request);
  }

  removeAdvice(id: string): Observable<void> {
    return this.http.delete<void>(`${this.base}/advice/${id}`);
  }
}
