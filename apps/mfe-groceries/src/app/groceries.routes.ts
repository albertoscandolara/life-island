import type { Routes } from '@angular/router';

/** What this remote exposes as `./routes`; the shell mounts it at /groceries. */
export const GROCERIES_ROUTES: Routes = [
  {
    path: '',
    pathMatch: 'full',
    loadComponent: () =>
      import('./groceries/groceries-page').then((m) => m.GroceriesPage),
    title: 'Groceries · Life Island',
  },
];
