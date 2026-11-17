import { TestBed } from '@angular/core/testing';
import { UiProgressBar } from './progress-bar';

describe('UiProgressBar', () => {
  it('caps the fill at 100% and takes the tone and size asked', async () => {
    const fixture = TestBed.createComponent(UiProgressBar);
    fixture.componentRef.setInput('value', 130);
    fixture.componentRef.setInput('tone', 'danger');
    fixture.componentRef.setInput('size', 'md');
    await fixture.whenStable();
    const host = fixture.nativeElement as HTMLElement;
    const bar = host.querySelector('.bar') as HTMLElement;
    expect(bar.style.width).toBe('100%');
    expect(bar.classList).toContain('bar--danger');
    expect(bar.classList).toContain('bar');
    expect(host.classList).toContain('size-md');
    expect(host.getAttribute('aria-valuenow')).toBe('100');
  });
});
