import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { GroceriesPage } from './groceries-page';

describe('GroceriesPage', () => {
  it('opens with its header and asks its service for the overview', async () => {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
      ],
    });
    const fixture = TestBed.createComponent(GroceriesPage);
    await fixture.whenStable();
    const element = fixture.nativeElement as HTMLElement;
    expect(element.querySelector('ui-page-header')).not.toBeNull();
    const requests = TestBed.inject(HttpTestingController).match((request) =>
      request.url.endsWith('/overview'),
    );
    expect(requests.length).toBeGreaterThan(0);
  });
});
