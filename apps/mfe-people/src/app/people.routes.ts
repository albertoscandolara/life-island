import type { Routes } from '@angular/router';

/** What this remote exposes as `./routes`; the shell mounts it at /people. */
export const PEOPLE_ROUTES: Routes = [
  {
    path: '',
    pathMatch: 'full',
    loadComponent: () =>
      import('./people/people-page').then((m) => m.PeoplePage),
    title: 'People & IDs · Life Island',
  },
];
