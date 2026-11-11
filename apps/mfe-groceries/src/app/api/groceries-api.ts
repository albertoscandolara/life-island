import { Injectable } from '@angular/core';
import type {
  ApplySuggestionRequest,
  GroceriesOverviewDto,
  LifeQuestionRequest,
  ShoppingSuggestionDto,
} from '@life-island/contracts';
import { RecordsApi } from '@life-island/records-ui';
import type { Observable } from 'rxjs';

/** Client for svc-groceries, the only service this module talks to (through the gateway). */
@Injectable({ providedIn: 'root' })
export class GroceriesApi extends RecordsApi {
  constructor() {
    super('/api/groceries');
  }

  overview(): Observable<GroceriesOverviewDto> {
    return this.http.get<GroceriesOverviewDto>(`${this.base}/overview`);
  }

  clearDone(): Observable<void> {
    return this.http.delete<void>(`${this.base}/list/done`);
  }

  suggest(request: LifeQuestionRequest): Observable<ShoppingSuggestionDto> {
    return this.http.post<ShoppingSuggestionDto>(`${this.base}/suggestions`, request);
  }

  apply(id: string, request: ApplySuggestionRequest): Observable<{ added: number }> {
    return this.http.post<{ added: number }>(`${this.base}/suggestions/${id}/apply`, request);
  }

  removeSuggestion(id: string): Observable<void> {
    return this.http.delete<void>(`${this.base}/suggestions/${id}`);
  }
}
