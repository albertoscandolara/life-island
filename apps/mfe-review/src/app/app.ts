import { Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';

/** Ptera's module: the character theme re-tints the accent for everything inside. */
@Component({
  imports: [RouterOutlet],
  selector: 'app-root',
  host: { 'data-character': 'ptera' },
  template: `<main class="page"><router-outlet /></main>`,
  styles: `
    :host {
      display: block;
    }
    .page {
      max-width: 80rem;
      margin: 0 auto;
      padding: var(--space-8) var(--space-4);
    }
  `,
})
export class App {}
