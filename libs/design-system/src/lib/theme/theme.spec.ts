import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { UI_THEME_STORAGE_KEY, UiThemeService } from './theme';
import { UiThemeToggle } from './theme-toggle';

/** A matchMedia stand-in whose dark-scheme answer the test controls. */
function fakeMatchMedia(prefersDark: boolean) {
  const listeners = new Set<(event: MediaQueryListEvent) => void>();
  const list = {
    matches: prefersDark,
    addEventListener: (_: string, fn: (event: MediaQueryListEvent) => void) =>
      listeners.add(fn),
    removeEventListener: (
      _: string,
      fn: (event: MediaQueryListEvent) => void,
    ) => listeners.delete(fn),
  };
  window.matchMedia = ((query: string) =>
    query.includes('prefers-color-scheme')
      ? list
      : { matches: true }) as unknown as typeof window.matchMedia;
  return {
    change(dark: boolean) {
      list.matches = dark;
      listeners.forEach((fn) => fn({ matches: dark } as MediaQueryListEvent));
    },
  };
}

@Component({ imports: [UiThemeToggle], template: `<ui-theme-toggle />` })
class Host {}

describe('UiThemeService', () => {
  const originalMatchMedia = window.matchMedia;

  beforeEach(() => {
    localStorage.clear();
    delete document.documentElement.dataset['theme'];
  });

  afterEach(() => {
    window.matchMedia = originalMatchMedia;
  });

  function setup() {
    const service = TestBed.inject(UiThemeService);
    TestBed.tick();
    return service;
  }

  it('follows the system setting until you choose, and tracks its changes', () => {
    const media = fakeMatchMedia(true);
    const service = setup();
    expect(service.preference()).toBe('system');
    expect(service.theme()).toBe('dark');
    expect(document.documentElement.dataset['theme']).toBe('dark');

    media.change(false);
    TestBed.tick();
    expect(service.theme()).toBe('light');
    expect(document.documentElement.dataset['theme']).toBe('light');
  });

  it('remembers an explicit choice over the system setting', () => {
    fakeMatchMedia(false);
    localStorage.setItem(UI_THEME_STORAGE_KEY, 'dark');
    const service = setup();
    expect(service.theme()).toBe('dark');

    service.setPreference('light');
    TestBed.tick();
    expect(localStorage.getItem(UI_THEME_STORAGE_KEY)).toBe('light');
    expect(document.documentElement.dataset['theme']).toBe('light');

    service.setPreference('system');
    expect(localStorage.getItem(UI_THEME_STORAGE_KEY)).toBeNull();
  });

  it('ignores an unknown stored value', () => {
    fakeMatchMedia(false);
    localStorage.setItem(UI_THEME_STORAGE_KEY, 'purple');
    expect(setup().preference()).toBe('system');
  });

  it('the toggle switches to the other theme and says what it will do', async () => {
    fakeMatchMedia(false);
    const fixture = TestBed.createComponent(Host);
    await fixture.whenStable();
    const button = (fixture.nativeElement as HTMLElement).querySelector(
      'button',
    ) as HTMLButtonElement;
    expect(button.getAttribute('aria-label')).toBe('Switch to dark theme');

    button.click();
    await fixture.whenStable();
    expect(document.documentElement.dataset['theme']).toBe('dark');
    expect(localStorage.getItem(UI_THEME_STORAGE_KEY)).toBe('dark');
    expect(button.getAttribute('aria-label')).toBe('Switch to light theme');
  });
});
