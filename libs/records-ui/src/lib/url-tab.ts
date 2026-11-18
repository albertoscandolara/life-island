import { inject, signal, type Signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, type Params } from '@angular/router';

/** The open tab of a page: read it like a signal, `set` it from a click. */
export interface UrlTab<T extends string> extends Signal<T> {
  /**
   * Opens a tab and writes it in the URL (the first tab leaves it out).
   * `query` changes other parameters in the same navigation, so two writes
   * cannot cancel each other.
   */
  set(tab: string, query?: Params): void;
}

/**
 * The open tab of an area's page, kept in the URL as `?tab=` (design
 * guidelines, "State lives in the URL"). It follows the URL too: a link to
 * another tab of the page you are on (from search, "Needs you" or the "Add"
 * menu) opens that tab, though the page stays.
 *
 * ```ts
 * protected readonly tab = urlTab(['week', 'body', 'events'], 'week');
 * ```
 * ```html
 * <li-tabs [tabs]="tabs" [active]="tab()" (activeChange)="tab.set($event)" />
 * ```
 */
export function urlTab<T extends string>(
  tabs: readonly T[],
  first: T,
  param = 'tab',
): UrlTab<T> {
  const route = inject(ActivatedRoute);
  const router = inject(Router);
  const parse = (value: string | null | undefined): T =>
    value && (tabs as readonly string[]).includes(value) ? (value as T) : first;

  const current = signal<T>(parse(route.snapshot.queryParamMap.get(param)));
  route.queryParamMap
    .pipe(takeUntilDestroyed())
    .subscribe((query) => current.set(parse(query.get(param))));

  const tab = current.asReadonly() as UrlTab<T>;
  tab.set = (value: string, query: Params = {}) => {
    const next = parse(value);
    current.set(next);
    void router.navigate([], {
      relativeTo: route,
      queryParams: { ...query, [param]: next === first ? null : next },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  };
  return tab;
}
