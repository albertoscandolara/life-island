import { DOCUMENT } from '@angular/common';
import {
  computed,
  DestroyRef,
  effect,
  inject,
  Injectable,
  signal,
} from '@angular/core';

export type UiTheme = 'light' | 'dark';
/** What you picked: a theme, or `system` to follow the device setting. */
export type UiThemePreference = UiTheme | 'system';

/** localStorage key; the inline script in each app's index.html reads it too. */
export const UI_THEME_STORAGE_KEY = 'life-island.theme';

const PREFERENCES: readonly UiThemePreference[] = ['system', 'light', 'dark'];

/**
 * The light/dark theme. It writes `data-theme` on `<html>`, which switches
 * every semantic token (styles/semantic.css), and remembers your choice.
 * Until you pick one it follows the system setting, live.
 */
@Injectable({ providedIn: 'root' })
export class UiThemeService {
  private readonly document = inject(DOCUMENT);
  private readonly window = this.document.defaultView;
  private readonly media = this.window?.matchMedia?.(
    '(prefers-color-scheme: dark)',
  );

  private readonly systemDark = signal(this.media?.matches ?? false);
  readonly preference = signal<UiThemePreference>(this.readStored());
  /** The theme on screen now. */
  readonly theme = computed<UiTheme>(() => {
    const preference = this.preference();
    if (preference !== 'system') return preference;
    return this.systemDark() ? 'dark' : 'light';
  });

  constructor() {
    const onChange = (event: MediaQueryListEvent) =>
      this.systemDark.set(event.matches);
    this.media?.addEventListener?.('change', onChange);
    inject(DestroyRef).onDestroy(() =>
      this.media?.removeEventListener?.('change', onChange),
    );

    effect(() => {
      this.document.documentElement.dataset['theme'] = this.theme();
    });
  }

  setPreference(preference: UiThemePreference): void {
    try {
      if (preference === 'system') {
        this.window?.localStorage.removeItem(UI_THEME_STORAGE_KEY);
      } else {
        this.window?.localStorage.setItem(UI_THEME_STORAGE_KEY, preference);
      }
    } catch {
      // Storage can be unavailable (private mode); the choice lasts this visit.
    }
    this.preference.set(preference);
  }

  /**
   * Switches to the other theme. With `origin` (the toggle's centre) and
   * browser support, the new theme grows as a circle from that point.
   */
  toggle(origin?: { x: number; y: number }): void {
    const next: UiTheme = this.theme() === 'dark' ? 'light' : 'dark';
    this.applyAnimated(() => {
      this.setPreference(next);
      // Write it now: the view transition captures the DOM right after this callback.
      this.document.documentElement.dataset['theme'] = next;
    }, origin);
  }

  private applyAnimated(
    change: () => void,
    origin?: { x: number; y: number },
  ): void {
    const root = this.document.documentElement;
    const reduceMotion = this.window?.matchMedia?.(
      '(prefers-reduced-motion: reduce)',
    ).matches;
    const startViewTransition = (
      this.document as Document & {
        startViewTransition?: (callback: () => void) => {
          ready: Promise<void>;
        };
      }
    ).startViewTransition;

    if (reduceMotion || !startViewTransition || !this.window) {
      root.classList.add('ui-theme-changing');
      change();
      this.window?.setTimeout(
        () => root.classList.remove('ui-theme-changing'),
        450,
      );
      return;
    }

    const x = origin?.x ?? this.window.innerWidth;
    const y = origin?.y ?? 0;
    const radius = Math.hypot(
      Math.max(x, this.window.innerWidth - x),
      Math.max(y, this.window.innerHeight - y),
    );
    const transition = startViewTransition.call(this.document, change);
    transition.ready
      .then(() =>
        root.animate(
          {
            clipPath: [
              `circle(0px at ${x}px ${y}px)`,
              `circle(${radius}px at ${x}px ${y}px)`,
            ],
          },
          {
            duration: 520,
            easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)',
            pseudoElement: '::view-transition-new(root)',
          },
        ),
      )
      .catch(() => undefined);
  }

  private readStored(): UiThemePreference {
    try {
      const stored = this.window?.localStorage.getItem(UI_THEME_STORAGE_KEY);
      return PREFERENCES.includes(stored as UiThemePreference)
        ? (stored as UiThemePreference)
        : 'system';
    } catch {
      return 'system';
    }
  }
}
