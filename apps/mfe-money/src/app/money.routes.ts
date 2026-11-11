import type { Routes } from '@angular/router';

/** What this remote exposes as `./routes`; the shell mounts it at /money. */
export const MONEY_ROUTES: Routes = [
  {
    path: '',
    pathMatch: 'full',
    loadComponent: () =>
      import('./money/money-page').then((m) => m.MoneyPage),
    title: 'Money · Life Island',
  },
];
