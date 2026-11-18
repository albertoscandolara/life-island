import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { urlTab } from './url-tab';

@Component({ template: '' })
class Page {
  readonly tab = urlTab(['week', 'body', 'events'], 'week');
}

describe('urlTab', () => {
  async function open(url: string) {
    TestBed.configureTestingModule({
      providers: [provideRouter([{ path: 'fitness', component: Page }])],
    });
    const harness = await RouterTestingHarness.create();
    const page = await harness.navigateByUrl(url, Page);
    return { harness, page, router: TestBed.inject(Router) };
  }

  it('reads the tab from the URL, and the first one when it is unknown', async () => {
    expect((await open('/fitness?tab=body')).page.tab()).toBe('body');
    TestBed.resetTestingModule();
    expect((await open('/fitness?tab=nope')).page.tab()).toBe('week');
  });

  it('follows a link to another tab of the page you are on', async () => {
    const { harness, page } = await open('/fitness');
    await harness.navigateByUrl('/fitness?tab=events');
    expect(page.tab()).toBe('events');
  });

  it('writes the tab in the URL, leaving out the first one', async () => {
    const { page, router } = await open('/fitness?x=1');
    page.tab.set('body', { item: 'a' });
    await new Promise((r) => setTimeout(r));
    expect(router.url).toBe('/fitness?x=1&item=a&tab=body');
    page.tab.set('week');
    await new Promise((r) => setTimeout(r));
    expect(router.url).toBe('/fitness?x=1&item=a');
  });
});
