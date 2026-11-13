import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import type {
  ApproveHouseSuggestionRequest,
  BillDto,
  HomePeopleDto,
  HouseSuggestionDto,
  KnownCompanyDto,
  CreatePropertyRequest,
  CreateWorkRequest,
  HomeDocumentDto,
  ListBillsQuery,
  OrganizationDetailDto,
  OrganizationDto,
  SupplyPointDto,
  UpdateOrganizationRequest,
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

  houseSuggestions(): Observable<HouseSuggestionDto[]> {
    return this.http.get<HouseSuggestionDto[]>(
      `${HOME_API}/houses/suggestions`,
    );
  }

  approveHouseSuggestion(
    request: ApproveHouseSuggestionRequest,
  ): Observable<PropertyDto> {
    return this.http.post<PropertyDto>(
      `${HOME_API}/houses/suggestions/approve`,
      request,
    );
  }

  dismissHouseSuggestion(uploadIds: string[]): Observable<void> {
    return this.http.post<void>(`${HOME_API}/houses/suggestions/dismiss`, {
      uploadIds,
    });
  }

  reopenHouseSuggestions(): Observable<{ reopened: number }> {
    return this.http.post<{ reopened: number }>(
      `${HOME_API}/houses/suggestions/reopen`,
      {},
    );
  }

  /** The people of the People area, to pick as owners. */
  people(): Observable<HomePeopleDto> {
    return this.http.get<HomePeopleDto>(`${HOME_API}/people`);
  }

  /** Companies already seen on bills, houses and works. */
  companies(): Observable<KnownCompanyDto[]> {
    return this.http.get<KnownCompanyDto[]>(`${HOME_API}/companies`);
  }

  uploadModel(id: string, file: File): Observable<PropertyDto> {
    return this.http.put<PropertyDto>(
      `${HOME_API}/properties/${id}/model`,
      file,
      {
        params: { filename: file.name },
        headers: { 'content-type': 'application/octet-stream' },
      },
    );
  }

  deleteModel(id: string): Observable<PropertyDto> {
    return this.http.delete<PropertyDto>(`${HOME_API}/properties/${id}/model`);
  }

  /** The house's 3D model file; `version` busts the cache when it is replaced. */
  modelUrl(id: string, version: string): string {
    return `${HOME_API}/properties/${id}/model?v=${encodeURIComponent(version)}`;
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

  /** The supply points (POD, PDR, water codes) your bills hang on, with their contracts. */
  supplyPoints(): Observable<SupplyPointDto[]> {
    return this.http.get<SupplyPointDto[]>(`${HOME_API}/supply-points`);
  }

  /** Moves a supply point, and every bill of it, to a house (null: none). */
  moveSupplyPoint(id: string, propertyId: string | null): Observable<unknown> {
    return this.http.patch(`${HOME_API}/supply-points/${id}`, { propertyId });
  }

  organizations(): Observable<OrganizationDto[]> {
    return this.http.get<OrganizationDto[]>(`${HOME_API}/organizations`);
  }

  updateOrganization(
    id: string,
    request: UpdateOrganizationRequest,
  ): Observable<OrganizationDto> {
    return this.http.patch<OrganizationDto>(
      `${HOME_API}/organizations/${id}`,
      request,
    );
  }

  organization(id: string): Observable<OrganizationDetailDto> {
    return this.http.get<OrganizationDetailDto>(
      `${HOME_API}/organizations/${id}`,
    );
  }

  /** Confirm, dismiss (not a company) or suggest again a company documents named. */
  setOrganizationStatus(
    id: string,
    action: 'confirm' | 'dismiss' | 'reopen',
  ): Observable<void> {
    return this.http.post<void>(
      `${HOME_API}/organizations/${id}/${action}`,
      {},
    );
  }

  confirmPendingOrganizations(): Observable<{ confirmed: number }> {
    return this.http.post<{ confirmed: number }>(
      `${HOME_API}/organizations/confirm-pending`,
      {},
    );
  }

  /** Merges `from` (a duplicate) into the company `into`. */
  mergeOrganization(
    into: string,
    from: string,
  ): Observable<OrganizationDetailDto> {
    return this.http.post<OrganizationDetailDto>(
      `${HOME_API}/organizations/${into}/merge`,
      { from },
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
