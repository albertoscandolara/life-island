import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { attentionBadge, HubPage } from './hub-page';
import { ISLAND_MODULES } from './modules';

describe('HubPage', () => {
  it('lists every module and links to the documents app', async () => {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
      ],
    });
    const fixture = TestBed.createComponent(HubPage);
    await fixture.whenStable();
    const element = fixture.nativeElement as HTMLElement;

    const names = [...element.querySelectorAll('.module__name')].map((n) =>
      n.textContent?.trim(),
    );
    expect(names).toEqual(ISLAND_MODULES.map((module) => module.name));
    expect(
      element.querySelector('.documents__link')?.getAttribute('href'),
    ).toBe('http://localhost:4201/');
  });

  it('shows what needs you on the People card', async () => {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
      ],
    });
    const fixture = TestBed.createComponent(HubPage);
    TestBed.inject(HttpTestingController)
      .expectOne('/api/people/attention')
      .flush({ expired: 1, expiring: 2, toReview: 0 });
    await fixture.whenStable();
    const element = fixture.nativeElement as HTMLElement;
    expect(
      element.querySelector('.module__attention')?.textContent?.trim(),
    ).toBe('1 expired · 2 expiring');
  });

  it('says nothing when all is fine', () => {
    expect(attentionBadge({ expired: 0, expiring: 0, toReview: 0 })).toBeNull();
    expect(attentionBadge({ expired: 0, expiring: 0, toReview: 3 })).toEqual({
      text: '3 to review',
      tone: 'info',
    });
  });
});

describe('HubPage with Settings → Island', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => localStorage.clear());

  it('leaves out the areas you turned off, never Settings', async () => {
    localStorage.setItem(
      'life-island.setting.island.hidden-areas',
      'cars,health',
    );
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
      ],
    });
    const fixture = TestBed.createComponent(HubPage);
    await fixture.whenStable();
    const element = fixture.nativeElement as HTMLElement;
    const names = [...element.querySelectorAll('.module__name')].map((n) =>
      n.textContent?.trim(),
    );
    expect(names).not.toContain('Cars');
    expect(names).not.toContain('Health');
    expect(names).toContain('Settings');
    expect(element.querySelector('.hidden-note')?.textContent).toContain(
      '2 areas are',
    );
  });
});
