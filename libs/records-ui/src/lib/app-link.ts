/**
 * A Life Island address as the areas send it (`/work?tab=review`,
 * `/cars#cars-review`), split for `routerLink`. A string with `?` or `#`
 * given to `[routerLink]` as is becomes one encoded path segment
 * (`/work%3Ftab%3Dreview`), so every link built from an area's `path` goes
 * through here: `[routerLink]="l.path" [queryParams]="l.query" [fragment]="l.fragment"`.
 */
export interface AppLink {
  path: string;
  query: Record<string, string>;
  /** The id of the block on the page that handles it, or undefined. */
  fragment: string | undefined;
}

export function appLink(url: string): AppLink {
  const [rest, fragment = ''] = url.split('#');
  const [pathname, search = ''] = rest.split('?');
  return {
    path: pathname || '/',
    query: Object.fromEntries(new URLSearchParams(search)),
    fragment: fragment ? decodeURIComponent(fragment) : undefined,
  };
}

/**
 * Brings the block with this id into view once it is on the page: a tab
 * just opened, or data still loading, renders it a moment later, so it
 * looks for it for a few seconds. It gets the focus too (without a second
 * scroll), so a keyboard or a screen reader lands where the button pointed.
 */
export function revealOnPage(
  id: string | null | undefined,
  waitMs = 4000,
): void {
  if (!id || typeof document === 'undefined') return;
  const started = Date.now();
  const look = () => {
    const target = document.getElementById(id);
    if (target) {
      target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      if (!target.hasAttribute('tabindex'))
        target.setAttribute('tabindex', '-1');
      target.focus({ preventScroll: true });
      return;
    }
    if (Date.now() - started < waitMs) setTimeout(look, 100);
  };
  setTimeout(look, 0);
}
