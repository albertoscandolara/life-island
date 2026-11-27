import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import type { DreamsOverviewDto } from '@life-island/contracts';
import { DreamsPage } from './dreams-page';

describe('DreamsPage', () => {
  it('opens with its header and asks its service for the overview', async () => {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
      ],
    });
    const fixture = TestBed.createComponent(DreamsPage);
    await fixture.whenStable();
    const element = fixture.nativeElement as HTMLElement;
    expect(element.querySelector('ui-page-header')).not.toBeNull();
    const requests = TestBed.inject(HttpTestingController).match((request) =>
      request.url.endsWith('/overview'),
    );
    expect(requests.length).toBeGreaterThan(0);
  });

  it('invites you to write a first dream when there is none', async () => {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
      ],
    });
    const fixture = TestBed.createComponent(DreamsPage);
    const http = TestBed.inject(HttpTestingController);
    const empty: DreamsOverviewDto = {
      today: '2026-11-14',
      weekStart: '2026-11-09',
      dreams: [],
      habits: [],
      reviews: [],
      reviewedThisWeek: false,
      aiQuestions: false,
      aiSteps: false,
    };
    http.expectOne((r) => r.url.endsWith('/overview')).flush(empty);
    fixture.detectChanges();
    await fixture.whenStable();
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('What would you love to reach?');
    expect(text).toContain('not a coach or a therapist');
  });

  it('keeps the habits moved from Goals, with their week and streak', async () => {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
      ],
    });
    const fixture = TestBed.createComponent(DreamsPage);
    const http = TestBed.inject(HttpTestingController);
    const overview: DreamsOverviewDto = {
      today: '2026-11-14',
      weekStart: '2026-11-09',
      dreams: [],
      habits: [
        {
          id: 'h1',
          title: 'Walk 30 minutes',
          dreamId: null,
          perWeek: 3,
          active: true,
          createdAt: '2026-09-01T00:00:00.000Z',
          checked: ['2026-11-10', '2026-11-12'],
          thisWeek: 2,
          streak: 4,
        },
      ],
      reviews: [],
      reviewedThisWeek: false,
      aiQuestions: false,
      aiSteps: false,
    };
    http.expectOne((r) => r.url.endsWith('/overview')).flush(overview);
    fixture.detectChanges();
    await fixture.whenStable();
    const element = fixture.nativeElement as HTMLElement;
    const habitsTab = [...element.querySelectorAll('button')].find((b) =>
      b.textContent?.includes('Habits'),
    );
    expect(habitsTab).toBeDefined();
    habitsTab!.click();
    fixture.detectChanges();
    await fixture.whenStable();
    const text = element.textContent ?? '';
    expect(text).toContain('Walk 30 minutes');
    expect(text).toContain('2 / 3');
    expect(text).toContain('🔥 4');
  });
});
