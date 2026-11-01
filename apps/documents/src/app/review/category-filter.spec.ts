import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { CategoryCountDto } from '@life-island/contracts';
import { SAMPLE_CATEGORIES } from '../testing/categories';
import { CategoryFilter } from './category-filter';

@Component({
  imports: [CategoryFilter],
  template: `<app-category-filter [(value)]="value" [counts]="counts()" />`,
})
class Host {
  readonly value = signal<string[]>([]);
  readonly counts = signal<CategoryCountDto[] | null>([
    { id: 'BILL', direct: 1, total: 3 },
    { id: 'ELECTRICITY_BILL', direct: 1, total: 1 },
  ]);
}

describe('CategoryFilter', () => {
  async function setup() {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    const fixture = TestBed.createComponent(Host);
    fixture.detectChanges();
    const http = TestBed.inject(HttpTestingController);
    http
      .expectOne((req) => req.url === '/api/ingestion/categories')
      .flush(SAMPLE_CATEGORIES);
    http
      .expectOne((req) => req.url === '/api/ingestion/category-suggestions')
      .flush([]);
    await fixture.whenStable();
    fixture.detectChanges();
    const element = fixture.nativeElement as HTMLElement;
    const open = () => {
      element.querySelector<HTMLButtonElement>('.trigger')!.click();
      fixture.detectChanges();
    };
    const option = (title: string) =>
      [...element.querySelectorAll<HTMLLabelElement>('.option')].find(
        (label) => label.querySelector('.option__title')!.textContent === title,
      )!;
    return { fixture, element, open, option, host: fixture.componentInstance };
  }

  it('says that a category includes its subcategories, with counts', async () => {
    const { element, open, option } = await setup();
    expect(element.querySelector('.trigger')!.textContent).toContain(
      'Any category',
    );
    open();
    expect(element.querySelector('.hint')!.textContent).toContain(
      'includes all its subcategories',
    );
    expect(option('Bill').querySelector('.count')!.textContent).toBe('3');
  });

  it('selecting a parent includes its descendants and replaces them', async () => {
    const { fixture, element, open, option, host } = await setup();
    open();
    element
      .querySelector<HTMLButtonElement>('[aria-label="Expand Bill"]')!
      .click();
    fixture.detectChanges();
    option('Gas Bill').querySelector('input')!.click();
    fixture.detectChanges();
    expect(host.value()).toEqual(['GAS_BILL']);

    option('Bill').querySelector('input')!.click();
    fixture.detectChanges();
    expect(host.value()).toEqual(['BILL']);
    const electricity = option('Electricity Bill').querySelector('input')!;
    expect(electricity.checked).toBe(true);
    expect(electricity.disabled).toBe(true);
    expect(option('Electricity Bill').textContent).toContain('in Bill');
    expect(element.querySelector('.trigger')!.textContent).toContain(
      'Bill + 2 below',
    );
  });

  it('combines several categories', async () => {
    const { fixture, element, open, option, host } = await setup();
    open();
    option('Bill').querySelector('input')!.click();
    option('Medical').querySelector('input')!.click();
    fixture.detectChanges();
    expect(host.value()).toEqual(['BILL', 'MEDICAL']);
    expect(element.querySelector('.trigger')!.textContent).toContain(
      '2 categories',
    );
  });
});
