import { DestroyRef, inject } from '@angular/core';

/**
 * Tells the page of an area that its records changed elsewhere: the island's
 * "Add" menu saved a reminder while the Agenda is open, and the Agenda reads
 * them again. A `window` event, so the shell and the areas' remotes need no
 * shared state (architecture.md, Communication).
 */
export const RECORDS_CHANGED_EVENT = 'li:records-changed';

export interface RecordsChangedDetail {
  /** The area's API, e.g. `/api/agenda`. */
  base: string;
  collection: string;
}

/** Says that a collection of an area changed. */
export function announceRecordsChanged(base: string, collection: string): void {
  globalThis.dispatchEvent?.(
    new CustomEvent<RecordsChangedDetail>(RECORDS_CHANGED_EVENT, {
      detail: { base, collection },
    }),
  );
}

/**
 * Calls `reload` when records of this area's API change elsewhere, for as long
 * as the page lives. Call it from a constructor or a field initializer.
 */
export function onRecordsChanged(base: string, reload: () => void): void {
  const listener = (event: Event) => {
    const detail = (event as CustomEvent<RecordsChangedDetail>).detail;
    if (detail?.base === base) reload();
  };
  globalThis.addEventListener?.(RECORDS_CHANGED_EVENT, listener);
  inject(DestroyRef).onDestroy(() =>
    globalThis.removeEventListener?.(RECORDS_CHANGED_EVENT, listener),
  );
}
