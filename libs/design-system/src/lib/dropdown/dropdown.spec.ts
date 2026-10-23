import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { UiDropdown, type UiOption } from './dropdown';

@Component({
  imports: [UiDropdown],
  template: `<ui-dropdown
    [options]="options"
    [(value)]="value"
    [clearable]="clearable()"
    aria-label="Status"
  />`,
})
class Host {
  readonly options: UiOption<string>[] = [
    { value: 'a', label: 'Alpha' },
    { value: 'b', label: 'Beta', tone: 'success' },
    { value: 'c', label: 'Gamma' },
  ];
  readonly value = signal<string | null>(null);
  readonly clearable = signal(false);
}

describe('UiDropdown', () => {
  async function setup() {
    const fixture = TestBed.createComponent(Host);
    await fixture.whenStable();
    const element = fixture.nativeElement as HTMLElement;
    const trigger = element.querySelector(
      '[role="combobox"]',
    ) as HTMLButtonElement;
    const press = async (key: string) => {
      trigger.dispatchEvent(
        new KeyboardEvent('keydown', { key, bubbles: true }),
      );
      await fixture.whenStable();
    };
    const options = () =>
      [...element.querySelectorAll('[role="option"]')] as HTMLElement[];
    return {
      fixture,
      host: fixture.componentInstance,
      element,
      trigger,
      press,
      options,
    };
  }

  it('shows the placeholder, then opens a listbox on click', async () => {
    const { fixture, trigger, options } = await setup();
    expect(trigger.textContent).toContain('Select…');
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    trigger.click();
    await fixture.whenStable();
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    expect(options().map((o) => o.textContent?.trim())).toEqual([
      'Alpha',
      'Beta',
      'Gamma',
    ]);
  });

  it('picks with the keyboard: open, move, wrap, Enter', async () => {
    const { host, trigger, press, options } = await setup();
    await press('ArrowDown');
    expect(trigger.getAttribute('aria-activedescendant')).toBe(options()[0].id);
    await press('ArrowUp');
    expect(trigger.getAttribute('aria-activedescendant')).toBe(options()[2].id);
    await press('Home');
    await press('ArrowDown');
    await press('Enter');
    expect(host.value()).toBe('b');
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(trigger.textContent).toContain('Beta');
  });

  it('closes on Escape without changing the value', async () => {
    const { host, trigger, press } = await setup();
    await press('Enter');
    await press('ArrowDown');
    await press('Escape');
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(host.value()).toBeNull();
  });

  it('offers a clear entry when clearable', async () => {
    const { fixture, host, trigger, options } = await setup();
    host.value.set('c');
    host.clearable.set(true);
    await fixture.whenStable();
    trigger.click();
    await fixture.whenStable();
    expect(options()[0].textContent?.trim()).toBe('Any');
    expect(options()[3].getAttribute('aria-selected')).toBe('true');
    options()[0].click();
    await fixture.whenStable();
    expect(host.value()).toBeNull();
  });
});
