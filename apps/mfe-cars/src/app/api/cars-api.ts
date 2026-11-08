import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import type {
  ApproveCarReviewRequest,
  CarsOverviewDto,
  CreateVehicleRequest,
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

  previewUrl(uploadId: string): string {
    return `${CARS_API}/documents/${uploadId}/preview`;
  }
}
