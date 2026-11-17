import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { UiDialogBase } from '../dialog/dialog-base';
import { UiInfoGuide, UiInfoTopic } from './info-guide';

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
  imports: [UiInfoGuide, UiInfoTopic],
  template: `
    <ui-info-guide
      heading="About the 730"
      [(open)]="open"
      [(topic)]="topic"
      (closed)="events.push('closed')"
    >
      <ui-info-topic key="basics" label="In short" intro="What it is."
        ><p>Basics body</p></ui-info-topic
      >
      <ui-info-topic key="glossary" label="Glossary"
        ><p>Glossary body</p></ui-info-topic
      >
    </ui-info-guide>
  `,
})
class Host {
  readonly open = signal(false);
  readonly topic = signal('');
  readonly events: string[] = [];
}

describe('UiInfoGuide', () => {
  async function setup() {
    const fixture = TestBed.createComponent(Host);
    await fixture.whenStable();
    const element = fixture.nativeElement as HTMLElement;
    const panels = () =>
      [...element.querySelectorAll<HTMLElement>('ui-info-topic')].map(
        (p) => !p.hidden,
      );
    return { fixture, host: fixture.componentInstance, element, panels };
  }

  it('keeps the popup API of every dialog', () => {
    expect(Object.getPrototypeOf(UiInfoGuide.prototype)).toBe(
      UiDialogBase.prototype,
    );
  });

  it('shows a Guide button and stays closed until it is pressed', async () => {
    const { fixture, host, element } = await setup();
    const trigger =
      element.querySelector<HTMLButtonElement>('.ui-info-trigger')!;
    expect(trigger.textContent).toContain('Guide');
    expect(element.querySelector('dialog')!.open).toBe(false);

    trigger.click();
    await fixture.whenStable();
    expect(host.open()).toBe(true);
    expect(element.querySelector('dialog')!.open).toBe(true);
    expect(element.querySelector('h2')!.textContent).toContain('About the 730');
  });

  it('shows the first topic, one tab per topic', async () => {
    const { element, panels } = await setup();
    const tabs = [...element.querySelectorAll('[role="tab"]')];
    expect(tabs.map((t) => t.textContent?.trim())).toEqual([
      'In short',
      'Glossary',
    ]);
    expect(tabs[0].getAttribute('aria-selected')).toBe('true');
    expect(panels()).toEqual([true, false]);
    expect(element.textContent).toContain('What it is.');
  });

  it('switches topic from a tab, and from the outside', async () => {
    const { fixture, host, element, panels } = await setup();
    element.querySelectorAll<HTMLButtonElement>('[role="tab"]')[1].click();
    await fixture.whenStable();
    expect(host.topic()).toBe('glossary');
    expect(panels()).toEqual([false, true]);

    host.topic.set('basics');
    await fixture.whenStable();
    expect(panels()).toEqual([true, false]);
  });

  it('closes from its close button and says so', async () => {
    const { fixture, host, element } = await setup();
    host.open.set(true);
    await fixture.whenStable();
    element
      .querySelector<HTMLButtonElement>('[aria-label="Close the guide"]')!
      .click();
    await fixture.whenStable();
    expect(host.open()).toBe(false);
    expect(host.events).toEqual(['closed']);
  });
});
