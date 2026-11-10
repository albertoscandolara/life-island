import { DOCUMENT } from '@angular/common';
import { DestroyRef, inject, Injectable } from '@angular/core';
import { NavigationEnd, Router } from '@angular/router';
import { START_PAGE_SETTING } from '@life-island/contracts';
import { BrowserSettings } from '@life-island/settings-ui';
import { filter } from 'rxjs';
import { ISLAND_MODULES } from './hub/modules';

/** Where this browser remembers the last area you opened (a convenience, not a setting). */
export const LAST_AREA_STORAGE_KEY = 'life-island.last-area';

/** The area a URL belongs to, as its path; null for the island and the rest. */
export function areaOf(url: string): string | null {
  const path = url.split(/[?#]/)[0];
  const module = ISLAND_MODULES.find(
    (m) => m.path && (path === m.path || path.startsWith(`${m.path}/`)),
  );
  return module?.path ?? null;
}

/**
 * Settings → Island → "Open on": remembers the area you use, and when Life
 * Island opens on the island with "Last area used" chosen, goes straight to
 * it. Only the first page of a visit is redirected; the island stays one
 * click away (the brand link).
 */
@Injectable({ providedIn: 'root' })
export class LastArea {
  private readonly router = inject(Router);
  private readonly settings = inject(BrowserSettings);
  private readonly storage = inject(DOCUMENT).defaultView?.localStorage;
  private readonly destroyRef = inject(DestroyRef);

  start(): void {
    let first = true;
    const subscription = this.router.events
      .pipe(filter((event) => event instanceof NavigationEnd))
      .subscribe((event) => {
        const url = event.urlAfterRedirects;
        const area = areaOf(url);
        if (first && url === '/') {
          first = false;
          const last = this.read();
          if (this.settings.value(START_PAGE_SETTING) === 'last' && last) {
            void this.router.navigateByUrl(last, { replaceUrl: true });
            return;
          }
        }
        first = false;
        if (area) this.write(area);
      });
    this.destroyRef.onDestroy(() => subscription.unsubscribe());
  }

  private read(): string | null {
    try {
      return this.storage?.getItem(LAST_AREA_STORAGE_KEY) ?? null;
    } catch {
      return null;
    }
  }

  private write(area: string): void {
    try {
      this.storage?.setItem(LAST_AREA_STORAGE_KEY, area);
    } catch {
      // Storage blocked: the island opens as usual.
    }
  }
}
