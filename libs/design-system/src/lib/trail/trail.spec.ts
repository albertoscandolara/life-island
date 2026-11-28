import { TestBed } from '@angular/core/testing';
import { UiTrail } from './trail';

describe('UiTrail', () => {
  it('marks the stop you are on and emits the stop you pick', async () => {
    const fixture = TestBed.createComponent(UiTrail);
    fixture.componentRef.setInput('stops', [
      { id: 'a', label: 'Basics', state: 'done' },
      { id: 'b', label: 'Agents', detail: '1 of 3 steps', state: 'current' },
      { id: 'c', label: 'Production', state: 'ahead' },
    ]);
    const picked: string[] = [];
    fixture.componentInstance.pick.subscribe((id) => picked.push(id));
    await fixture.whenStable();
    const host = fixture.nativeElement as HTMLElement;
    const stops = host.querySelectorAll('li');
    expect(stops).toHaveLength(3);
    expect(stops[1].getAttribute('aria-current')).toBe('step');
    expect(stops[1].textContent).toContain('You are here');
    expect(stops[0].getAttribute('aria-current')).toBeNull();
    (stops[2].querySelector('button') as HTMLButtonElement).click();
    expect(picked).toEqual(['c']);
  });
});
