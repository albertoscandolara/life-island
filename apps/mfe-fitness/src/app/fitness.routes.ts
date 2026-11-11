import type { Routes } from '@angular/router';

/** What this remote exposes as `./routes`; the shell mounts it at /fitness. */
export const FITNESS_ROUTES: Routes = [
  {
    path: '',
    pathMatch: 'full',
    loadComponent: () =>
      import('./fitness/fitness-page').then((m) => m.FitnessPage),
    title: 'Fitness · Life Island',
  },
];
