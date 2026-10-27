import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { HubPage } from './hub-page';
import { ISLAND_MODULES } from './modules';

describe('HubPage', () => {
  it('lists every module and links to the documents app', async () => {
    TestBed.configureTestingModule({ providers: [provideRouter([])] });
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
});
