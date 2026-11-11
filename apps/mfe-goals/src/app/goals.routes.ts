import type { Routes } from '@angular/router';

/** What this remote exposes as `./routes`; the shell mounts it at /goals. */
export const GOALS_ROUTES: Routes = [
  {
    path: '',
    pathMatch: 'full',
    loadComponent: () =>
      import('./goals/goals-page').then((m) => m.GoalsPage),
    title: 'Goals & habits · Life Island',
  },
];
