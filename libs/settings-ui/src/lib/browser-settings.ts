import { DOCUMENT } from '@angular/common';
import { DestroyRef, inject, Injectable, signal } from '@angular/core';
import {
  APP_SETTINGS,
  type AppSettingDefinition,
} from '@life-island/contracts';

/** Where this browser keeps a setting of `browser` scope (the theme has its own key). */
export function browserSettingStorageKey(key: string): string {
  return `life-island.setting.${key}`;
}

/**
 * Sent on the window after a change: the shell and each remote bundle their
 * own copy of this service, and the browser's `storage` event reaches only
 * other tabs.
 */
export const BROWSER_SETTINGS_EVENT = 'life-island:browser-settings';

/** The browser settings this service keeps: every `browser` one but the theme (UiThemeService). */
export const BROWSER_SETTINGS: readonly AppSettingDefinition[] =
  APP_SETTINGS.filter(
    (setting) =>
      setting.scope === 'browser' && setting.key !== 'appearance.theme',
  );

/**
 * The settings this browser keeps (APP_SETTINGS with `scope: 'browser'`):
 * how the island looks and opens. They live in localStorage, shared by the
 * shell and every remote it hosts, and follow changes made in another tab.
 * Storage that cannot be read (a private window) falls back to the defaults.
 */
@Injectable({ providedIn: 'root' })
export class BrowserSettings {
  private readonly view = inject(DOCUMENT).defaultView;
  private readonly storage = this.storageOf();
  private readonly stored = signal(this.readAll());

  constructor() {
    const sync = () => this.stored.set(this.readAll());
    this.view?.addEventListener('storage', sync);
    this.view?.addEventListener(BROWSER_SETTINGS_EVENT, sync);
    inject(DestroyRef).onDestroy(() => {
      this.view?.removeEventListener('storage', sync);
      this.view?.removeEventListener(BROWSER_SETTINGS_EVENT, sync);
    });
  }

  private storageOf(): Storage | undefined {
    try {
      return this.view?.localStorage;
    } catch {
      return undefined;
    }
  }

  private changed(): void {
    this.view?.dispatchEvent(new Event(BROWSER_SETTINGS_EVENT));
  }

  /** The value, or the setting's default while this browser has none. */
  value(key: string): string {
    return (
      this.stored()[key] ??
      String(APP_SETTINGS.find((s) => s.key === key)?.default ?? '')
    );
  }

  /** Whether this browser has its own value (it can be reset). */
  isSet(key: string): boolean {
    return key in this.stored();
  }

  /** Every value this browser has set, for a backup. */
  values(): Record<string, string> {
    return { ...this.stored() };
  }

  set(key: string, value: string): void {
    try {
      this.storage?.setItem(browserSettingStorageKey(key), value);
    } catch {
      // Storage full or blocked: the value still holds for this page.
    }
    this.stored.update((all) => ({ ...all, [key]: value }));
    this.changed();
  }

  reset(key: string): void {
    try {
      this.storage?.removeItem(browserSettingStorageKey(key));
    } catch {
      // Nothing stored that could be read either.
    }
    this.stored.update((all) => {
      const next = { ...all };
      delete next[key];
      return next;
    });
    this.changed();
  }

  private readAll(): Record<string, string> {
    const values: Record<string, string> = {};
    for (const setting of BROWSER_SETTINGS) {
      try {
        const value = this.storage?.getItem(
          browserSettingStorageKey(setting.key),
        );
        if (value !== null && value !== undefined) values[setting.key] = value;
      } catch {
        // Unreadable storage: the default.
      }
    }
    return values;
  }
}

/** The island areas you turned off (Settings → Island), as ids. */
export function hiddenAreas(value: string): Set<string> {
  return new Set(
    value
      .split(',')
      .map((id) => id.trim())
      .filter(Boolean),
  );
}
