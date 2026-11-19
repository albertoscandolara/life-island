import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import type { NeedsYouDto } from '@life-island/contracts';
import { LiNeedsYou } from './needs-you';
import { urlTab } from './url-tab';

@Component({
  imports: [LiNeedsYou],
  template: `<li-needs-you module="work" />
    <p id="work-review">{{ tab() }}</p>`,
})
class WorkPage {
  readonly tab = urlTab(['career', 'review'], 'career');
}

describe('LiNeedsYou, clicked', () => {
  async function workPageWaitingFor(path: string) {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([{ path: 'work', component: WorkPage }]),
        provideHttpClient(),
        provideHttpClientTesting(),
      ],
    });
    const harness = await RouterTestingHarness.create();
    const page = await harness.navigateByUrl('/work', WorkPage);
    const needs: NeedsYouDto = {
      module: 'work',
      today: '2026-11-19',
      entries: [],
      waiting: [
        {
          key: 'work:document:1',
          module: 'work',
          id: 'document:1',
          kind: 'document',
          title: 'UNI T23111314.pdf',
          detail: 'Payslip',
          since: '2026-11-10',
          path,
          action: 'Review',
        },
      ],
      answered: true,
    };
    TestBed.inject(HttpTestingController)
      .expectOne((r) => r.url === '/api/agenda/needs')
      .flush(needs);
    harness.detectChanges();
    const button = harness.routeNativeElement!.querySelector(
      'a[aria-label^="Review"]',
    ) as HTMLAnchorElement;
    return { harness, page, button, router: TestBed.inject(Router) };
  }

  it('opens the tab where the documents wait, from the page itself', async () => {
    const { harness, page, button, router } =
      await workPageWaitingFor('/work?tab=review');
    expect(button.getAttribute('href')).toBe('/work?tab=review');
    button.click();
    await harness.fixture.whenStable();
    expect(router.url).toBe('/work?tab=review');
    expect(page.tab()).toBe('review');
  });

  it('brings a block of this page into view', async () => {
    const scrolled = vi.fn();
    Element.prototype.scrollIntoView = scrolled;
    const { harness, button, router } =
      await workPageWaitingFor('/work#work-review');
    button.click();
    await harness.fixture.whenStable();
    await new Promise((r) => setTimeout(r, 20));
    expect(router.url).toBe('/work#work-review');
    expect(scrolled).toHaveBeenCalled();
    expect(document.activeElement?.id).toBe('work-review');
  });
});
