import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { announceRecordsChanged, onRecordsChanged } from './records-changed';

let reloads = 0;

@Component({ template: '' })
class Page {
  constructor() {
    onRecordsChanged('/api/agenda', () => reloads++);
  }
}

describe('records changed', () => {
  beforeEach(() => (reloads = 0));

  it('reloads the page of the area that changed, until it closes', () => {
    const fixture = TestBed.createComponent(Page);
    announceRecordsChanged('/api/agenda', 'items');
    announceRecordsChanged('/api/fitness', 'workouts');
    expect(reloads).toBe(1);
    fixture.destroy();
    announceRecordsChanged('/api/agenda', 'items');
    expect(reloads).toBe(1);
  });
});
