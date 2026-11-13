import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import type { EntityRefDto } from '@life-island/contracts';
import {
  ENTITY_LINK_BASE,
  ENTITY_SOURCES,
  EntityDirectory,
} from './entity-directory';
import { EntityLink } from './entity-link';

const ENTITIES: EntityRefDto[] = [
  {
    kind: 'house',
    id: 'h1',
    name: 'Ronco all’Adige',
    status: 'confirmed',
    detail: 'Via Ponzilovo 9',
    aliases: ['Via Ponzilovo 9', 'Via Ponzilovo'],
  },
  {
    kind: 'organization',
    id: 'o1',
    name: 'EDILRENSO SNC DI RENSO MASSIMO E C.',
    status: 'confirmed',
    detail: null,
    aliases: [],
  },
  {
    kind: 'organization',
    id: 'o2',
    name: 'Idroterm',
    status: 'pending',
    detail: null,
    aliases: [],
  },
];

@Component({
  imports: [EntityLink],
  template: `<p>
    <li-entity-link [name]="name()" [kind]="kind()" [entityId]="id()" />
  </p>`,
})
class Host {
  readonly name = signal<string | null>('Edilrenso');
  readonly kind = signal<'house' | 'organization' | undefined>(undefined);
  readonly id = signal<string | null>(null);
}

async function render(base = '', sources = ['/api/home/entities']) {
  TestBed.configureTestingModule({
    imports: [Host],
    providers: [
      provideHttpClient(),
      provideHttpClientTesting(),
      provideRouter([]),
      { provide: ENTITY_LINK_BASE, useValue: base },
      { provide: ENTITY_SOURCES, useValue: sources },
    ],
  });
  const fixture = TestBed.createComponent(Host);
  fixture.detectChanges();
  const http = TestBed.inject(HttpTestingController);
  return { fixture, http };
}

async function answered(base = '') {
  const { fixture, http } = await render(base);
  http.expectOne('/api/home/entities').flush(ENTITIES);
  await TestBed.inject(EntityDirectory).load();
  fixture.detectChanges();
  return { fixture, http };
}

describe('EntityLink', () => {
  it('links a confirmed company found by its printed name', async () => {
    const { fixture } = await answered();
    const a = fixture.nativeElement.querySelector('a') as HTMLAnchorElement;
    expect(a.textContent?.trim()).toBe('Edilrenso');
    expect(a.getAttribute('href')).toBe('/home/companies?company=o1');
  });

  it('links a house by id, with its own name when none is given', async () => {
    const { fixture } = await answered();
    fixture.componentInstance.name.set(null);
    fixture.componentInstance.kind.set('house');
    fixture.componentInstance.id.set('h1');
    fixture.detectChanges();
    const a = fixture.nativeElement.querySelector('a') as HTMLAnchorElement;
    expect(a.textContent?.trim()).toBe('Ronco all’Adige');
    expect(a.getAttribute('href')).toBe('/home?houses=h1');
  });

  it('marks a pending one and sends it where it is confirmed', async () => {
    const { fixture } = await answered();
    fixture.componentInstance.name.set('Idroterm');
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('a')?.getAttribute('href')).toBe(
      '/home/companies?review=entities',
    );
    expect(el.textContent).toContain('to confirm');
  });

  it('shows an unknown name as plain text', async () => {
    const { fixture } = await answered();
    fixture.componentInstance.name.set('Banca Sconosciuta');
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('a')).toBeNull();
    expect(el.textContent?.trim()).toBe('Banca Sconosciuta');
  });

  it('opens the Life Island app from another app', async () => {
    const { fixture } = await answered('http://localhost:4200/');
    expect(fixture.nativeElement.querySelector('a')?.getAttribute('href')).toBe(
      'http://localhost:4200/home/companies?company=o1',
    );
  });

  it('keeps names as text when an area does not answer', async () => {
    const { fixture, http } = await render();
    http
      .expectOne('/api/home/entities')
      .flush('down', { status: 502, statusText: 'Bad Gateway' });
    await TestBed.inject(EntityDirectory).load();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('a')).toBeNull();
    expect(fixture.nativeElement.textContent.trim()).toBe('Edilrenso');
  });
});
