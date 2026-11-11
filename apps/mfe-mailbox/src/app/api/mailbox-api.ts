import { Injectable } from '@angular/core';
import type { LetterDto, MailboxOverviewDto } from '@life-island/contracts';
import { RecordsApi } from '@life-island/records-ui';
import type { Observable } from 'rxjs';

/** Client for svc-mailbox, the only service this module talks to (through the gateway). */
@Injectable({ providedIn: 'root' })
export class MailboxApi extends RecordsApi {
  constructor() {
    super('/api/mailbox');
  }

  overview(): Observable<MailboxOverviewDto> {
    return this.http.get<MailboxOverviewDto>(`${this.base}/overview`);
  }

  explain(id: string): Observable<LetterDto> {
    return this.http.post<LetterDto>(`${this.base}/letters/${id}/explain`, {});
  }

  applyExplanation(id: string): Observable<void> {
    return this.http.post<void>(
      `${this.base}/letters/${id}/apply-explanation`,
      {},
    );
  }
}
