import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import type { AgendaWaitingDto } from '@life-island/contracts';
import { WaitingList } from './waiting-list';

describe('WaitingList', () => {
  it('shows each thing with its area and a button to where it is handled', async () => {
    TestBed.configureTestingModule({ providers: [provideRouter([])] });
    const fixture = TestBed.createComponent(WaitingList);
    const item: AgendaWaitingDto = {
      key: 'groceries:running-out:milk',
      module: 'groceries',
      id: 'running-out:milk',
      kind: 'running-out',
      title: 'Milk is probably running out',
      detail: 'You buy it about every 6 days.',
      since: '2026-11-16',
      path: '/groceries',
      action: 'Add to list',
    };
    fixture.componentRef.setInput('items', [item]);
    await fixture.whenStable();
    const element = fixture.nativeElement as HTMLElement;
    expect(element.textContent).toContain('Milk is probably running out');
    expect(element.textContent).toContain('Groceries');
    const link = element.querySelector('a');
    expect(link?.getAttribute('href')).toBe('/groceries');
    expect(link?.textContent).toContain('Add to list');
  });
});
