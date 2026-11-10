import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import type {
  ApproveCarReviewRequest,
  CarsOverviewDto,
  CarsPeopleDto,
  CreateTyreSetRequest,
  CreateVehicleRequest,
  QuoteComparisonDto,
  UpdateFineRequest,
  UpdateTyreSetRequest,
  GroupCarDocumentRequest,
  MarkCarDocumentRequest,
  UpdateVehicleRequest,
} from '@life-island/contracts';
import type { Observable } from 'rxjs';

export const CARS_API = '/api/cars';

/** Client for svc-cars, the only service this module talks to (through the gateway). */
@Injectable({ providedIn: 'root' })
export class CarsApi {
  private readonly http = inject(HttpClient);

  overview(): Observable<CarsOverviewDto> {
    return this.http.get<CarsOverviewDto>(`${CARS_API}/overview`);
  }

  approve(
    uploadId: string,
    request: ApproveCarReviewRequest,
  ): Observable<void> {
    return this.http.post<void>(
      `${CARS_API}/reviews/${uploadId}/approve`,
      request,
    );
  }

  reject(uploadId: string): Observable<void> {
    return this.http.post<void>(`${CARS_API}/reviews/${uploadId}/reject`, {});
  }

  reopen(uploadId: string): Observable<void> {
    return this.http.post<void>(`${CARS_API}/reviews/${uploadId}/reopen`, {});
  }

  mark(uploadId: string, request: MarkCarDocumentRequest): Observable<void> {
    return this.http.patch<void>(`${CARS_API}/documents/${uploadId}`, request);
  }

  /** Puts the document in the record of another (attachTo), or in one of its own (null). */
  group(uploadId: string, request: GroupCarDocumentRequest): Observable<void> {
    return this.http.put<void>(
      `${CARS_API}/documents/${uploadId}/group`,
      request,
    );
  }

  /** The people of the People area, to pick as the holder or owner of a car. */
  people(): Observable<CarsPeopleDto> {
    return this.http.get<CarsPeopleDto>(`${CARS_API}/people`);
  }

  createVehicle(request: CreateVehicleRequest): Observable<{ id: string }> {
    return this.http.post<{ id: string }>(`${CARS_API}/vehicles`, request);
  }

  updateVehicle(id: string, request: UpdateVehicleRequest): Observable<void> {
    return this.http.patch<void>(`${CARS_API}/vehicles/${id}`, request);
  }

  /** Removes the car; its documents go back to review. */
  removeVehicle(id: string): Observable<void> {
    return this.http.delete<void>(`${CARS_API}/vehicles/${id}`);
  }

  /** Uploads the car's 3D model (.glb, .gltf with embedded buffers, or .obj). */
  uploadModel(id: string, file: File): Observable<void> {
    return this.http.put<void>(`${CARS_API}/vehicles/${id}/model`, file, {
      params: { filename: file.name },
      headers: { 'content-type': 'application/octet-stream' },
    });
  }

  deleteModel(id: string): Observable<void> {
    return this.http.delete<void>(`${CARS_API}/vehicles/${id}/model`);
  }

  /** The car's 3D model file; `version` busts the cache when it is replaced. */
  modelUrl(id: string, version: string): string {
    return `${CARS_API}/vehicles/${id}/model?v=${encodeURIComponent(version)}`;
  }

  /** What you add to a fine by hand: when it reached you, when you paid, who drove. */
  updateFine(uploadId: string, request: UpdateFineRequest): Observable<void> {
    return this.http.put<void>(`${CARS_API}/fines/${uploadId}`, request);
  }

  createTyreSet(
    vehicleId: string,
    request: CreateTyreSetRequest,
  ): Observable<{ id: string }> {
    return this.http.post<{ id: string }>(
      `${CARS_API}/vehicles/${vehicleId}/tyres`,
      request,
    );
  }

  updateTyreSet(id: string, request: UpdateTyreSetRequest): Observable<void> {
    return this.http.patch<void>(`${CARS_API}/tyres/${id}`, request);
  }

  removeTyreSet(id: string): Observable<void> {
    return this.http.delete<void>(`${CARS_API}/tyres/${id}`);
  }

  /** Claude compares the quotes with the car's current policy (multipart). */
  compareQuotes(
    vehicleId: string,
    quotes: readonly File[],
    note: string | null,
  ): Observable<QuoteComparisonDto> {
    const form = new FormData();
    for (const file of quotes) form.append('quotes', file, file.name);
    if (note) form.append('note', note);
    return this.http.post<QuoteComparisonDto>(
      `${CARS_API}/vehicles/${vehicleId}/insurance-quotes`,
      form,
    );
  }

  removeComparison(id: string): Observable<void> {
    return this.http.delete<void>(`${CARS_API}/quote-comparisons/${id}`);
  }

  previewUrl(uploadId: string): string {
    return `${CARS_API}/documents/${uploadId}/preview`;
  }
}
