import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import type {
  AddAttachmentRequest,
  DossierExpenseDto,
  ExpenseDto,
  Tax730DocumentCandidateDto,
  TaxYearDossierDto,
  TaxYearDto,
  UpdateExpenseRequest,
} from '@life-island/contracts';
import type { Observable } from 'rxjs';

export const TAX730_API = '/api/tax730';

/** Client for svc-tax730, the only service this module talks to (through the gateway). */
@Injectable({ providedIn: 'root' })
export class Tax730Api {
  private readonly http = inject(HttpClient);

  taxYears(): Observable<TaxYearDto[]> {
    return this.http.get<TaxYearDto[]>(`${TAX730_API}/tax-years`);
  }

  dossier(year: number): Observable<TaxYearDossierDto> {
    return this.http.get<TaxYearDossierDto>(`${TAX730_API}/tax-years/${year}`);
  }

  updateExpense(
    id: string,
    request: UpdateExpenseRequest,
  ): Observable<ExpenseDto> {
    return this.http.patch<ExpenseDto>(`${TAX730_API}/expenses/${id}`, request);
  }

  addExpenseAttachment(
    id: string,
    request: AddAttachmentRequest,
  ): Observable<DossierExpenseDto> {
    return this.http.post<DossierExpenseDto>(
      `${TAX730_API}/expenses/${id}/attachments`,
      request,
    );
  }

  removeExpenseAttachment(
    id: string,
    uploadId: string,
  ): Observable<DossierExpenseDto> {
    return this.http.delete<DossierExpenseDto>(
      `${TAX730_API}/expenses/${id}/attachments/${uploadId}`,
    );
  }

  addYearAttachment(
    year: number,
    request: AddAttachmentRequest,
  ): Observable<TaxYearDossierDto> {
    return this.http.post<TaxYearDossierDto>(
      `${TAX730_API}/tax-years/${year}/attachments`,
      request,
    );
  }

  removeYearAttachment(
    year: number,
    uploadId: string,
  ): Observable<TaxYearDossierDto> {
    return this.http.delete<TaxYearDossierDto>(
      `${TAX730_API}/tax-years/${year}/attachments/${uploadId}`,
    );
  }

  documents(params: {
    search?: string;
    forExpense?: string;
  }): Observable<Tax730DocumentCandidateDto[]> {
    const query: Record<string, string> = {};
    if (params.search) query['search'] = params.search;
    if (params.forExpense) query['forExpense'] = params.forExpense;
    return this.http.get<Tax730DocumentCandidateDto[]>(
      `${TAX730_API}/documents`,
      { params: query },
    );
  }

  /** Links the browser follows directly (downloads and previews). */
  previewUrl(uploadId: string): string {
    return `${TAX730_API}/documents/${uploadId}/preview`;
  }

  zipUrl(year: number): string {
    return `${TAX730_API}/tax-years/${year}/export.zip`;
  }

  workbookUrl(years: number[] = []): string {
    const query = years.map((year) => `year=${year}`).join('&');
    return `${TAX730_API}/exports/deductions.xlsx${query ? `?${query}` : ''}`;
  }
}
