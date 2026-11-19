import { Injectable } from '@angular/core';
import type {
  LifeQuestionRequest,
  MatchesDto,
  MatchLinkRequest,
  MatchRejectRequest,
  MovementAttachmentDto,
  MovementLinkDto,
  MoneyOverviewDto,
  ReceiptReadingDto,
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

  /** Files receipts, order screenshots or photos with a movement. */
  attach(
    movementId: string,
    files: readonly File[],
  ): Observable<MovementAttachmentDto[]> {
    const form = new FormData();
    for (const file of files) form.append('files', file, file.name);
    return this.http.post<MovementAttachmentDto[]>(
      `${this.base}/transactions/${movementId}/attachments`,
      form,
    );
  }

  /** Forgets a receipt of a movement (the document stays in Documents). */
  detach(movementId: string, attachmentId: string): Observable<void> {
    return this.http.delete<void>(
      `${this.base}/transactions/${movementId}/attachments/${attachmentId}`,
    );
  }

  /** Where the browser shows a receipt. */
  previewUrl(attachmentId: string): string {
    return `${this.base}/attachments/${attachmentId}/preview`;
  }

  /** Reads the receipts already filed with a movement (money.receipt-reader). */
  readMovement(movementId: string): Observable<ReceiptReadingDto> {
    return this.http.post<ReceiptReadingDto>(
      `${this.base}/transactions/${movementId}/read`,
      {},
    );
  }

  /** Reads receipts not filed yet, for a new expense; nothing is kept. */
  readReceipts(
    files: readonly File[],
    note: string | null,
  ): Observable<ReceiptReadingDto> {
    const form = new FormData();
    for (const file of files) form.append('files', file, file.name);
    if (note) form.append('note', note);
    return this.http.post<ReceiptReadingDto>(
      `${this.base}/receipts/read`,
      form,
    );
  }

  /** Money matching: what is proposed, open and linked. */
  matches(): Observable<MatchesDto> {
    return this.http.get<MatchesDto>(`${this.base}/matches`);
  }

  link(request: MatchLinkRequest): Observable<MovementLinkDto[]> {
    return this.http.post<MovementLinkDto[]>(
      `${this.base}/matches/links`,
      request,
    );
  }

  unlink(id: string): Observable<void> {
    return this.http.delete<void>(`${this.base}/matches/links/${id}`);
  }

  reject(request: MatchRejectRequest): Observable<void> {
    return this.http.post<void>(`${this.base}/matches/rejections`, request);
  }
}
