import { Injectable } from '@angular/core';
import type {
  LifeQuestionRequest,
  MoneyOverviewDto,
  SpendingReviewDto,
  TransactionImportRequest,
} from '@life-island/contracts';
import { RecordsApi } from '@life-island/records-ui';
import type { Observable } from 'rxjs';

/** Client for svc-money, the only service this module talks to (through the gateway). */
@Injectable({ providedIn: 'root' })
export class MoneyApi extends RecordsApi {
  constructor() {
    super('/api/money');
  }

  overview(): Observable<MoneyOverviewDto> {
    return this.http.get<MoneyOverviewDto>(`${this.base}/overview`);
  }

  importTransactions(
    request: TransactionImportRequest,
  ): Observable<{ added: number; skipped: number }> {
    return this.http.post<{ added: number; skipped: number }>(
      `${this.base}/transactions/import`,
      request,
    );
  }

  writeReview(request: LifeQuestionRequest): Observable<SpendingReviewDto> {
    return this.http.post<SpendingReviewDto>(`${this.base}/reviews`, request);
  }

  removeReview(id: string): Observable<void> {
    return this.http.delete<void>(`${this.base}/reviews/${id}`);
  }
}
