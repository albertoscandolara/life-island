import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { flushReclassification } from '../testing/reclassification';
import { HomePage } from './home-page';

describe('HomePage', () => {
  async function setup() {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
      ],
    });
    const fixture = TestBed.createComponent(HomePage);
    fixture.detectChanges();
    const http = TestBed.inject(HttpTestingController);
    flushReclassification(http);
    return { fixture, http, element: fixture.nativeElement as HTMLElement };
  }

  it('offers the loader, the review and the categories, with how many records wait', async () => {
    const { fixture, http, element } = await setup();
    const links = [...element.querySelectorAll('a.choice')].map((a) =>
      a.getAttribute('href'),
    );
    expect(links).toEqual(['/upload', '/review', '/categories']);

    const request = http.expectOne((req) => req.url === '/api/review/records');
    expect(request.request.params.get('status')).toBe('PARSED');
    request.flush({ items: [], total: 3, limit: 1, offset: 0 });
    await fixture.whenStable();
    expect(element.querySelector('.choice__badge')?.textContent).toContain(
      '3 waiting for review',
    );
  });

  it('hides the count when the review service is down', async () => {
    const { fixture, http, element } = await setup();
    http
      .expectOne((req) => req.url === '/api/review/records')
      .flush('down', { status: 502, statusText: 'Bad Gateway' });
    await fixture.whenStable();
    expect(element.querySelector('.choice__badge')).toBeNull();
  });
});
