import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import type {
  BillDto,
  CreatePropertyRequest,
  CreateWorkRequest,
  HomeDocumentDto,
  ListBillsQuery,
  PropertyDto,
  UpdateBillRequest,
  UpdatePropertyRequest,
  UpdateWorkRequest,
  WorkDto,
} from '@life-island/contracts';
import type { Observable } from 'rxjs';

export const HOME_API = '/api/home';

/** Client for svc-home, the only service this module talks to (through the gateway). */
@Injectable({ providedIn: 'root' })
export class HomeApi {
  private readonly http = inject(HttpClient);

  properties(): Observable<PropertyDto[]> {
    return this.http.get<PropertyDto[]>(`${HOME_API}/properties`);
  }

  createProperty(request: CreatePropertyRequest): Observable<PropertyDto> {
    return this.http.post<PropertyDto>(`${HOME_API}/properties`, request);
  }

  updateProperty(
    id: string,
    request: UpdatePropertyRequest,
  ): Observable<PropertyDto> {
    return this.http.patch<PropertyDto>(
      `${HOME_API}/properties/${id}`,
      request,
    );
  }

  deleteProperty(id: string): Observable<void> {
    return this.http.delete<void>(`${HOME_API}/properties/${id}`);
  }

  bills(query: ListBillsQuery = {}): Observable<BillDto[]> {
    const params: Record<string, string | string[]> = {};
    if (query.property) params['property'] = query.property;
    if (query.utility)
      params['utility'] = Array.isArray(query.utility)
        ? query.utility
        : [query.utility];
    if (query.from) params['from'] = query.from;
    if (query.to) params['to'] = query.to;
    return this.http.get<BillDto[]>(`${HOME_API}/bills`, { params });
  }

  updateBill(
    uploadId: string,
    request: UpdateBillRequest,
  ): Observable<{ bill: BillDto | null }> {
    return this.http.patch<{ bill: BillDto | null }>(
      `${HOME_API}/bills/${uploadId}`,
      request,
    );
  }

  works(property?: string): Observable<WorkDto[]> {
    return this.http.get<WorkDto[]>(`${HOME_API}/works`, {
      params: property ? { property } : {},
    });
  }

  createWork(request: CreateWorkRequest): Observable<WorkDto> {
    return this.http.post<WorkDto>(`${HOME_API}/works`, request);
  }

  updateWork(id: string, request: UpdateWorkRequest): Observable<WorkDto> {
    return this.http.patch<WorkDto>(`${HOME_API}/works/${id}`, request);
  }

  deleteWork(id: string): Observable<void> {
    return this.http.delete<void>(`${HOME_API}/works/${id}`);
  }

  attachDocument(id: string, uploadId: string): Observable<WorkDto> {
    return this.http.post<WorkDto>(`${HOME_API}/works/${id}/documents`, {
      uploadId,
    });
  }

  detachDocument(id: string, uploadId: string): Observable<WorkDto> {
    return this.http.delete<WorkDto>(
      `${HOME_API}/works/${id}/documents/${uploadId}`,
    );
  }

  documents(search: string): Observable<HomeDocumentDto[]> {
    return this.http.get<HomeDocumentDto[]>(`${HOME_API}/documents`, {
      params: search ? { search } : {},
    });
  }

  previewUrl(uploadId: string): string {
    return `${HOME_API}/documents/${uploadId}/preview`;
  }
}

/** A readable message for a failed call; a stopped service gets a hint to start it. */
export function errorMessage(error: unknown): string {
  const status = (error as { status?: number })?.status;
  if (status === 0 || status === 502 || status === 504)
    return 'The home service is not reachable. Start it with `npx nx serve svc-home`.';
  const body = (
    error as {
      error?: {
        message?: string;
        issues?: { path: string; message: string }[];
      };
    }
  )?.error;
  if (body?.issues?.length)
    return body.issues.map((i) => `${i.path}: ${i.message}`).join('; ');
  return (
    body?.message ??
    (error as { message?: string })?.message ??
    'Something went wrong'
  );
}
