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
      dreams: [],
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
});
