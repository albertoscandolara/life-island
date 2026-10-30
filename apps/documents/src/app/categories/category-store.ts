import { HttpErrorResponse } from '@angular/common/http';
import { computed, inject, Injectable } from '@angular/core';
import { rxResource } from '@angular/core/rxjs-interop';
import { IngestionApi } from '../api/ingestion-api';

/**
 * The category catalog shared by the review and categories pages: confirmed
 * categories and pending suggestions, loaded once and reloaded after any
 * change, so both pages show the same names.
 */
@Injectable({ providedIn: 'root' })
export class CategoryStore {
  private readonly api = inject(IngestionApi);

  readonly confirmed = rxResource({ stream: () => this.api.categories() });
  readonly suggested = rxResource({
    stream: () => this.api.suggestions({ status: 'PENDING' }),
  });

  private readonly titles = computed(() => {
    const titles = new Map<string, string>();
    for (const suggestion of this.suggested.value() ?? [])
      titles.set(suggestion.categoryId, suggestion.title);
    for (const category of this.confirmed.value() ?? [])
      titles.set(category.id, category.title);
    return titles;
  });

  /** The title of a confirmed or suggested category; its id if unknown. */
  titleOf(id: string): string {
    return this.titles().get(id) ?? id;
  }

  reload(): void {
    this.confirmed.reload();
    this.suggested.reload();
  }
}

/** The server's reason for a failed request, in words; a generic one if none. */
export function errorMessage(error: unknown): string {
  if (error instanceof HttpErrorResponse) {
    const body = error.error as {
      message?: string | string[];
      issues?: { path: string; message: string }[];
    } | null;
    if (body?.issues?.length)
      return body.issues
        .map(
          (issue) => `${issue.path ? `${issue.path}: ` : ''}${issue.message}`,
        )
        .join('; ');
    if (typeof body?.message === 'string') return body.message;
    if (Array.isArray(body?.message)) return body.message.join('; ');
  }
  return 'The request failed. Try again.';
}
