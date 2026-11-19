import { Injectable } from '@angular/core';
import type {
  ApplySuggestionRequest,
  GroceriesOverviewDto,
  GroceryItemRequest,
  GroceryItemStatsDto,
  LifeQuestionRequest,
  ReceiptDetailDto,
  ReceiptUpdateRequest,
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
    return this.http.post<ShoppingSuggestionDto>(
      `${this.base}/suggestions`,
      request,
    );
  }

  apply(
    id: string,
    request: ApplySuggestionRequest,
  ): Observable<{ added: number }> {
    return this.http.post<{ added: number }>(
      `${this.base}/suggestions/${id}/apply`,
      request,
    );
  }

  removeSuggestion(id: string): Observable<void> {
    return this.http.delete<void>(`${this.base}/suggestions/${id}`);
  }

  receipt(id: string): Observable<ReceiptDetailDto> {
    return this.http.get<ReceiptDetailDto>(`${this.base}/receipts/${id}`);
  }

  updateReceipt(id: string, request: ReceiptUpdateRequest): Observable<void> {
    return this.http.patch<void>(`${this.base}/receipts/${id}`, request);
  }

  /** The document the receipt was read from, shown by the browser. */
  documentUrl(receiptId: string): string {
    return `${this.base}/receipts/${receiptId}/document`;
  }

  /** Renames an item (on every receipt line), moves its aisle, sets its link. */
  updateItem(
    id: string,
    request: GroceryItemRequest,
  ): Observable<{ id: string }> {
    return this.http.put<{ id: string }>(`${this.base}/items/${id}`, request);
  }

  /** Removes it from What you buy; its receipt lines stay in your spending. */
  removeItem(id: string): Observable<void> {
    return this.http.delete<void>(`${this.base}/items/${id}`);
  }

  uploadItemImage(id: string, file: File): Observable<void> {
    return this.http.put<void>(`${this.base}/items/${id}/image`, file, {
      headers: { 'content-type': 'application/octet-stream' },
    });
  }

  removeItemImage(id: string): Observable<void> {
    return this.http.delete<void>(`${this.base}/items/${id}/image`);
  }

  /** Its photo, or null when it has none. */
  itemImageUrl(item: GroceryItemStatsDto): string | null {
    return item.id && item.imageVersion
      ? `${this.base}/items/${item.id}/image?v=${item.imageVersion}`
      : null;
  }
}
