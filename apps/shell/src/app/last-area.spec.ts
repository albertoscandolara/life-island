import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { browserSettingStorageKey } from '@life-island/settings-ui';
import { areaOf, LAST_AREA_STORAGE_KEY, LastArea } from './last-area';

@Component({ template: '' })
class Blank {}

describe('LastArea', () => {
  beforeEach(() => localStorage.clear());

  it('knows which area a URL is in', () => {
    expect(areaOf('/cars/abc?tab=insurance')).toBe('/cars');
    expect(areaOf('/taxes/730/2025')).toBe('/taxes/730');
    expect(areaOf('/')).toBeNull();
  });

  async function open(url: string) {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([
          { path: '', component: Blank },
          { path: 'cars', component: Blank },
          { path: 'work', component: Blank },
        ]),
      ],
    });
    TestBed.inject(LastArea).start();
    const router = TestBed.inject(Router);
    await router.navigateByUrl(url);
    await TestBed.inject(Router).navigated;
    return router;
  }

  it('remembers the last area and opens on it when you chose so', async () => {
    localStorage.setItem(LAST_AREA_STORAGE_KEY, '/cars');
    localStorage.setItem(browserSettingStorageKey('island.start-page'), 'last');
    const router = await open('/');
    await new Promise((resolve) => setTimeout(resolve));
    expect(router.url).toBe('/cars');
  });

  it('opens on the island by default', async () => {
    localStorage.setItem(LAST_AREA_STORAGE_KEY, '/cars');
    const router = await open('/');
    await new Promise((resolve) => setTimeout(resolve));
    expect(router.url).toBe('/');
    await router.navigateByUrl('/work');
    expect(localStorage.getItem(LAST_AREA_STORAGE_KEY)).toBe('/work');
  });
});
