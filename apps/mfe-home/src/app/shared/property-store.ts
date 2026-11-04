import { inject, Injectable, signal } from '@angular/core';
import type { PropertyDto } from '@life-island/contracts';
import { errorMessage, HomeApi } from '../api/home-api';

/** Your properties, loaded once and shared by Home and Bills. */
@Injectable({ providedIn: 'root' })
export class PropertyStore {
  private readonly api = inject(HomeApi);

  readonly properties = signal<PropertyDto[] | null>(null);
  readonly error = signal<string | null>(null);

  constructor() {
    this.reload();
  }

  reload(): void {
    this.api.properties().subscribe({
      next: (properties) => {
        this.error.set(null);
        this.properties.set(properties);
      },
      error: (error) => {
        this.properties.set([]);
        this.error.set(errorMessage(error));
      },
    });
  }

  name(id: string | null): string {
    if (!id) return 'Unassigned';
    return this.properties()?.find((p) => p.id === id)?.name ?? 'Unknown home';
  }

  slot(id: string | null): number {
    return this.properties()?.find((p) => p.id === id)?.colorSlot ?? -1;
  }
}
