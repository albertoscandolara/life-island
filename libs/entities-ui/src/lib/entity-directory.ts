import { HttpClient } from '@angular/common/http';
import { inject, Injectable, InjectionToken, signal } from '@angular/core';
import {
  ENTITY_DIRECTORY_SOURCES,
  findEntity,
  type EntityKind,
  type EntityRefDto,
} from '@life-island/contracts';
import { catchError, firstValueFrom, of } from 'rxjs';

/**
 * Where entity pages live. Empty inside the Life Island app, whose router
 * opens them; the documents app provides the Life Island app's URL, and its
 * links open there.
 */
export const ENTITY_LINK_BASE = new InjectionToken<string>('ENTITY_LINK_BASE', {
  factory: () => '',
});

/** The areas to ask for entities; tests and standalone apps can narrow it. */
export const ENTITY_SOURCES = new InjectionToken<readonly string[]>(
  'ENTITY_SOURCES',
  { factory: () => ENTITY_DIRECTORY_SOURCES },
);

/**
 * Every entity of every area, read once from each area's `GET /entities`
 * and kept for the page's life. An area that does not answer only leaves
 * its entities out: their names show as plain text.
 */
@Injectable({ providedIn: 'root' })
export class EntityDirectory {
  private readonly http = inject(HttpClient);
  private readonly sources = inject(ENTITY_SOURCES);
  private loading: Promise<void> | null = null;

  readonly entities = signal<readonly EntityRefDto[]>([]);
  readonly loaded = signal(false);

  /** Reads the directory, once; later calls wait for the same read. */
  load(): Promise<void> {
    this.loading ??= this.read();
    return this.loading;
  }

  /** Reads it again: after you confirm, merge or rename an entity. */
  refresh(): Promise<void> {
    this.loading = this.read();
    return this.loading;
  }

  /** The entity a printed name stands for, or null when none (or several) fit. */
  find(
    name: string | null | undefined,
    kind?: EntityKind | readonly EntityKind[],
  ): EntityRefDto | null {
    return findEntity(name, this.entities(), kind);
  }

  byId(kind: EntityKind, id: string | null | undefined): EntityRefDto | null {
    if (!id) return null;
    return this.entities().find((e) => e.kind === kind && e.id === id) ?? null;
  }

  private async read(): Promise<void> {
    const lists = await Promise.all(
      this.sources.map((url) =>
        firstValueFrom(
          this.http
            .get<EntityRefDto[]>(url)
            .pipe(catchError(() => of([] as EntityRefDto[]))),
        ),
      ),
    );
    this.entities.set(lists.flat());
    this.loaded.set(true);
  }
}
