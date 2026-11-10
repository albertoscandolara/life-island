import type { Routes } from '@angular/router';

/** What this remote exposes as `./routes`; the shell mounts it at /studies. */
export const STUDIES_ROUTES: Routes = [
  {
    path: '',
    pathMatch: 'full',
    loadComponent: () =>
      import('./studies/studies-page').then((m) => m.StudiesPage),
    title: 'Studies · Life Island',
  },
];
