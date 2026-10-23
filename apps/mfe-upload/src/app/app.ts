import { Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';

@Component({
  imports: [RouterOutlet],
  selector: 'app-root',
  template: `<main class="page"><router-outlet /></main>`,
  styles: `
    .page {
      max-width: 72rem;
      margin: 0 auto;
      padding: var(--space-8) var(--space-4);
    }
  `,
})
export class App {}
