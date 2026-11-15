import type { Routes } from '@angular/router';

/** What this remote exposes as `./routes`; the shell mounts it at /dreams. */
export const DREAMS_ROUTES: Routes = [
  {
    path: '',
    pathMatch: 'full',
    loadComponent: () =>
      import('./dreams/dreams-page').then((m) => m.DreamsPage),
    title: 'Dreams · Life Island',
  },
];
