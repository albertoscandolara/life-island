import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { UiConfirmDialog } from './confirm-dialog';
import { UiDialogBase } from './dialog-base';

// jsdom has <dialog> but not always its modal methods.
const proto = HTMLDialogElement.prototype as HTMLDialogElement &
  Record<string, unknown>;
proto.showModal ??= function (this: HTMLDialogElement) {
  this.setAttribute('open', '');
};
proto.close ??= function (this: HTMLDialogElement) {
  this.removeAttribute('open');
};

@Component({
  imports: [UiConfirmDialog],
  template: `
    <ui-confirm-dialog
      [(open)]="open"
      heading="Delete it?"
      confirmLabel="Delete"
      [busy]="busy()"
      (confirmed)="events.push('confirmed')"
      (cancelled)="events.push('cancelled')"
      (closed)="events.push('closed')"
    >
      <p>Body text</p>
    </ui-confirm-dialog>
  `,
})
class Host {
  readonly open = signal(true);
  readonly busy = signal(false);
  readonly events: string[] = [];
}

describe('UiConfirmDialog', () => {
  async function setup() {
    const fixture = TestBed.createComponent(Host);
    await fixture.whenStable();
    const element = fixture.nativeElement as HTMLElement;
    const button = (label: string) =>
      [...element.querySelectorAll('button')].find(
        (b) => b.textContent?.trim() === label,
      ) as HTMLButtonElement;
    return { fixture, host: fixture.componentInstance, element, button };
  }

  it('inherits the base popup API', () => {
    expect(Object.getPrototypeOf(UiConfirmDialog.prototype)).toBe(
      UiDialogBase.prototype,
    );
  });

  it('shows the heading, the body and both actions', async () => {
    const { element, button } = await setup();
    expect(element.querySelector('h2')?.textContent).toContain('Delete it?');
    expect(element.textContent).toContain('Body text');
    expect(button('Cancel')).toBeTruthy();
    expect(button('Delete')).toBeTruthy();
  });

  it('emits confirmed and stays open so the caller can save', async () => {
    const { fixture, host, button } = await setup();
    button('Delete').click();
    await fixture.whenStable();
    expect(host.events).toEqual(['confirmed']);
    expect(host.open()).toBe(true);
  });

  it('cancel emits cancelled, closes and updates the two-way open', async () => {
    const { fixture, host, button } = await setup();
    button('Cancel').click();
    await fixture.whenStable();
    expect(host.events).toEqual(['cancelled', 'closed']);
    expect(host.open()).toBe(false);
  });

  it('cannot be cancelled while busy', async () => {
    const { fixture, host, button } = await setup();
    host.busy.set(true);
    await fixture.whenStable();
    expect(button('Cancel').disabled).toBe(true);
    expect(button('Delete').disabled).toBe(true);
    expect(
      [...fixture.nativeElement.querySelectorAll('button')].some(
        (b: HTMLButtonElement) => b.getAttribute('aria-label') === 'Close',
      ),
    ).toBe(false);
  });
});
