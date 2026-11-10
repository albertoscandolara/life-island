import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import {
  ActivatedRoute,
  convertToParamMap,
  provideRouter,
} from '@angular/router';
import { SAMPLE_CATEGORIES } from '../testing/categories';
import { flushReclassification } from '../testing/reclassification';
import { CategoriesPage, editsOf, parentCandidates } from './categories-page';

const original = {
  id: 'ENEL',
  title: 'Enel',
  description: 'Documents issued by Enel',
  template: {
    fields: [
      {
        key: 'total_amount',
        label: 'Total',
        type: 'amount' as const,
        description: '',
        required: true,
      },
    ],
  },
};
const draftOf = (changes: Partial<Record<string, string>> = {}) => ({
  id: original.id,
  title: original.title,
  description: original.description,
  template: JSON.stringify(original.template, null, 2),
  ...changes,
});

describe('editsOf', () => {
  it('sends only what you changed', () => {
    expect(editsOf(original, draftOf())).toEqual({});
    expect(
      editsOf(
        original,
        draftOf({ id: ' ENEL_ENERGIA ', title: 'Enel Energia' }),
      ),
    ).toEqual({ id: 'ENEL_ENERGIA', title: 'Enel Energia' });
  });

  it('sends the template when its JSON changed, and throws on invalid JSON', () => {
    expect(
      editsOf(original, draftOf({ template: '{"fields": []}' })).template,
    ).toEqual({ fields: [] });
    expect(() => editsOf(original, draftOf({ template: '{' }))).toThrow();
  });
});

describe('parentCandidates', () => {
  const excluded = new Set(['TAX', 'PROPERTY_TAX', 'IMU']);
  const tax = SAMPLE_CATEGORIES.find((category) => category.id === 'TAX')!;

  it('never offers the category itself or what is below it, nor another dimension', () => {
    expect(
      parentCandidates(SAMPLE_CATEGORIES, tax, excluded).map((c) => c.id),
    ).toEqual(['BILL', 'ELECTRICITY_BILL', 'GAS_BILL']);
  });

  it('lets a general category go under any parent', () => {
    const expense = SAMPLE_CATEGORIES.find((c) => c.id === 'EXPENSE')!;
    expect(
      parentCandidates(SAMPLE_CATEGORIES, expense, new Set(['EXPENSE'])),
    ).toHaveLength(SAMPLE_CATEGORIES.length - 1);
  });
});

// jsdom has <dialog> but not always its modal methods.
const dialogProto = HTMLDialogElement.prototype as HTMLDialogElement &
  Record<string, unknown>;
dialogProto.showModal ??= function (this: HTMLDialogElement) {
  this.setAttribute('open', '');
};
dialogProto.close ??= function (this: HTMLDialogElement) {
  this.removeAttribute('open');
};

describe('CategoriesPage', () => {
  async function setup(selected: string | null = null) {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        {
          provide: ActivatedRoute,
          useValue: {
            snapshot: {
              queryParamMap: convertToParamMap(
                selected ? { category: selected } : {},
              ),
            },
          },
        },
      ],
    });
    const fixture = TestBed.createComponent(CategoriesPage);
    fixture.detectChanges();
    const http = TestBed.inject(HttpTestingController);
    http
      .expectOne((req) => req.url === '/api/ingestion/categories')
      .flush(SAMPLE_CATEGORIES);
    http
      .expectOne((req) => req.url === '/api/ingestion/category-suggestions')
      .flush([]);
    flushReclassification(http);
    // The AI tool switch next to the suggestions: Settings unreachable.
    for (const request of http.match('/api/settings/overview'))
      request.flush(null, { status: 503, statusText: 'Unavailable' });
    await fixture.whenStable();
    fixture.detectChanges();
    const element = fixture.nativeElement as HTMLElement;
    const text = (selector: string) =>
      [...element.querySelectorAll(selector)].map((node) =>
        node.textContent!.replace(/\s+/g, ' ').trim(),
      );
    /** After a change the page reloads the categories and suggestions. */
    const reloaded = async () => {
      // Let the save resolve; the reloads then wait to be answered.
      await new Promise((resolve) => setTimeout(resolve));
      fixture.detectChanges();
      http.expectOne('/api/ingestion/categories').flush(SAMPLE_CATEGORIES);
      http
        .expectOne((req) => req.url === '/api/ingestion/category-suggestions')
        .flush([]);
      await fixture.whenStable();
      fixture.detectChanges();
    };
    return { fixture, http, element, text, reloaded };
  }

  afterEach(() => TestBed.inject(HttpTestingController).verify());

  it('shows the hierarchy as a tree that expands', async () => {
    const { fixture, element, text } = await setup();
    expect(text('.node__title')).toEqual(['Bill', 'Tax', 'Medical', 'Expense']);
    element
      .querySelector<HTMLButtonElement>('[aria-label="Expand Bill"]')!
      .click();
    fixture.detectChanges();
    expect(text('.node__title')).toEqual([
      'Bill',
      'Electricity Bill',
      'Gas Bill',
      'Tax',
      'Medical',
      'Expense',
    ]);
    expect(text('.empty-state, ui-empty-state .heading')).toContain(
      'Select a category',
    );
  });

  it('shows the path from the root, the children and everything below', async () => {
    const { fixture, element, text } = await setup('PROPERTY_TAX');
    expect(text('.path li')).toEqual(['Tax', 'Property Tax']);
    expect(text('.path__current')).toEqual(['Property Tax']);
    expect(text('.chip')).toEqual(['Imu 0']);
    // The tree opened down to the selection, and marks it.
    expect(text('.node--selected .node__title')).toEqual(['Property Tax']);

    element.querySelector<HTMLButtonElement>('.path .link')!.click();
    fixture.detectChanges();
    expect(text('.path__current')).toEqual(['Tax']);
    expect(text('.chip')).toEqual(['Property Tax 0']);
    const showAll = [...element.querySelectorAll('button')].find((button) =>
      button.textContent!.includes('Show all 2 below'),
    )!;
    showAll.click();
    fixture.detectChanges();
    expect(text('.descendants .link')).toEqual(['Property Tax', 'Imu']);
  });

  it('moves a category under another parent and back to the top level', async () => {
    const { fixture, http, element, reloaded } = await setup('GAS_BILL');
    const parent = element.querySelector<HTMLButtonElement>(
      '[aria-label="Parent category"]',
    )!;
    parent.click();
    fixture.detectChanges();
    const options = [
      ...element.querySelectorAll<HTMLElement>('[role="option"]'),
    ];
    // Not itself; the top level is offered first.
    expect(options.map((option) => option.textContent!.trim())).toEqual([
      'None (top level)',
      'Bill',
      'Bill › Electricity Bill',
      'Tax',
      'Tax › Property Tax',
      'Tax › Property Tax › Imu',
    ]);
    options[2].click();
    fixture.detectChanges();
    const move = http.expectOne('/api/ingestion/categories/GAS_BILL');
    expect(move.request.method).toBe('PATCH');
    expect(move.request.body).toEqual({ parentId: 'ELECTRICITY_BILL' });
    move.flush(SAMPLE_CATEGORIES[2]);
    await reloaded();

    element
      .querySelector<HTMLButtonElement>('[aria-label="Parent category"]')!
      .click();
    fixture.detectChanges();
    element.querySelector<HTMLElement>('[role="option"]')!.click();
    const root = http.expectOne('/api/ingestion/categories/GAS_BILL');
    expect(root.request.body).toEqual({ parentId: null });
    root.flush(SAMPLE_CATEGORIES[2]);
    await reloaded();
  });

  it('asks what happens to the subcategories and documents of a deleted category', async () => {
    const { fixture, http, element, reloaded } = await setup('BILL');
    element
      .querySelector<HTMLButtonElement>('[aria-label="Delete Bill"]')!
      .click();
    fixture.detectChanges();
    const dialog = document.querySelector('dialog[open]') ?? element;
    expect(dialog.textContent).toContain('Its 2 subcategories');
    expect(dialog.textContent).toContain('never deleted');
    const confirm = [
      ...document.querySelectorAll<HTMLButtonElement>('button'),
    ].find((button) => button.textContent!.trim() === 'Delete')!;
    confirm.click();
    const request = http.expectOne((req) =>
      req.url.startsWith('/api/ingestion/categories/BILL'),
    );
    expect(request.request.method).toBe('DELETE');
    expect(request.request.params.get('children')).toBe('MOVE_TO_PARENT');
    expect(request.request.params.get('documents')).toBe('REMOVE');
    request.flush(null);
    await reloaded();
  });
});
