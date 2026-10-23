import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import {
  UiCellDef,
  UiTable,
  type UiTableColumn,
  type UiTableSort,
} from './table';

interface Row {
  id: number;
  name: string;
  score: number;
}

@Component({
  imports: [UiTable, UiCellDef],
  template: `
    <ui-table
      [columns]="columns"
      [rows]="rows()"
      [(sort)]="sort"
      [(page)]="page"
      [pageSize]="2"
      [total]="total()"
      emptyMessage="No rows"
    >
      <ng-template uiCell="score" [uiCellOf]="rows()" let-row>
        <strong>{{ row.score * 10 }}</strong>
      </ng-template>
    </ui-table>
  `,
})
class Host {
  readonly columns: UiTableColumn[] = [
    { key: 'name', header: 'Name', sortable: true },
    { key: 'score', header: 'Score' },
  ];
  readonly rows = signal<Row[]>([
    { id: 1, name: 'Ann', score: 3 },
    { id: 2, name: 'Bob', score: 5 },
  ]);
  readonly sort = signal<UiTableSort | null>(null);
  readonly page = signal(0);
  readonly total = signal<number | null>(5);
}

describe('UiTable', () => {
  async function setup() {
    const fixture = TestBed.createComponent(Host);
    await fixture.whenStable();
    const element = fixture.nativeElement as HTMLElement;
    return { fixture, host: fixture.componentInstance, element };
  }

  it('renders plain and templated cells', async () => {
    const { element } = await setup();
    const cells = [...element.querySelectorAll('tbody tr')].map((tr) =>
      [...tr.querySelectorAll('td')].map((td) => td.textContent?.trim()),
    );
    expect(cells).toEqual([
      ['Ann', '30'],
      ['Bob', '50'],
    ]);
    expect(element.querySelector('td')?.getAttribute('data-label')).toBe(
      'Name',
    );
  });

  it('sorts descending first, then toggles, and resets the page', async () => {
    const { fixture, host, element } = await setup();
    host.page.set(1);
    await fixture.whenStable();
    const header = element.querySelector('th') as HTMLElement;
    expect(header.getAttribute('aria-sort')).toBe('none');

    (header.querySelector('button') as HTMLButtonElement).click();
    await fixture.whenStable();
    expect(host.sort()).toEqual({ key: 'name', direction: 'desc' });
    expect(host.page()).toBe(0);
    expect(header.getAttribute('aria-sort')).toBe('descending');

    (header.querySelector('button') as HTMLButtonElement).click();
    await fixture.whenStable();
    expect(host.sort()).toEqual({ key: 'name', direction: 'asc' });
  });

  it('pages within bounds', async () => {
    const { fixture, host, element } = await setup();
    const pager = () =>
      element.querySelector('.ui-table__pager') as HTMLElement;
    const next = () =>
      pager().querySelector('[aria-label="Next page"]') as HTMLButtonElement;
    expect(pager().textContent).toContain('1–2 of 5');
    next().click();
    next().click();
    await fixture.whenStable();
    expect(host.page()).toBe(2);
    expect(pager().textContent).toContain('5–5 of 5');
    expect(next().disabled).toBe(true);
  });

  it('shows the empty message and hides the pager without rows', async () => {
    const { fixture, host, element } = await setup();
    host.rows.set([]);
    host.total.set(0);
    await fixture.whenStable();
    expect(element.querySelector('tbody')?.textContent?.trim()).toBe('No rows');
    expect(element.querySelector('.ui-table__pager')).toBeNull();
  });
});
