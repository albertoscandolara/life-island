import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import type {
  SubscriptionDto,
  SubscriptionsOverviewDto,
} from '@life-island/contracts';
import { SubscriptionsPage } from './subscriptions-page';

describe('SubscriptionsPage', () => {
  it('opens with its header and asks its service for the overview', async () => {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
      ],
    });
    const fixture = TestBed.createComponent(SubscriptionsPage);
    await fixture.whenStable();
    const element = fixture.nativeElement as HTMLElement;
    expect(element.querySelector('ui-page-header')).not.toBeNull();
    const requests = TestBed.inject(HttpTestingController).match((request) =>
      request.url.endsWith('/overview'),
    );
    expect(requests.length).toBeGreaterThan(0);
  });

  it('shows a charge over the price and updates the cost to it', async () => {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
      ],
    });
    const fixture = TestBed.createComponent(SubscriptionsPage);
    await fixture.whenStable();
    const http = TestBed.inject(HttpTestingController);
    const item = {
      id: 'c1',
      name: 'Streamflix',
      provider: null,
      kind: 'streaming',
      cost: 12.99,
      cycle: 'monthly',
      startOn: null,
      renewsOn: '2026-11-03',
      autoRenew: true,
      autoPay: true,
      noticeDays: 0,
      lockedUntil: null,
      status: 'active',
      usage: null,
      paidWith: null,
      cancelUrl: null,
      notes: null,
      createdAt: '2026-01-01T00:00:00Z',
      yearly: 155.88,
      monthly: 12.99,
      nextRenewal: '2026-12-03',
      cancelBy: null,
      daysToCancelBy: null,
      priceChanges: [],
      lastCharge: {
        date: '2026-11-03',
        paid: 13.99,
        expected: 12.99,
        paidOn: '2026-11-04',
        accounts: ['Conto'],
        priceRise: 1,
      },
    } as SubscriptionDto;
    for (const request of http.match((r) => r.url.endsWith('/overview')))
      request.flush({
        today: '2026-11-18',
        items: [item],
        totals: { monthly: 12.99, yearly: 155.88, active: 1, unused: 0 },
        byKind: [],
        advice: [],
        aiAdvisor: false,
      } satisfies SubscriptionsOverviewDto);
    await fixture.whenStable();
    fixture.detectChanges();
    const element = fixture.nativeElement as HTMLElement;
    expect(element.textContent).toContain('Last charge');
    const update = [...element.querySelectorAll('button')].find((b) =>
      b.textContent?.includes('Update the cost to'),
    );
    expect(update).toBeDefined();
    update!.click();
    const put = http.expectOne(
      (r) => r.method === 'PUT' && r.url.endsWith('/items/c1'),
    );
    expect(put.request.body).toEqual({ cost: 13.99 });
  });
});
