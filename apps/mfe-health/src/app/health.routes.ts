import type { Routes } from '@angular/router';

/** What this remote exposes as `./routes`; the shell mounts it at /health. */
export const HEALTH_ROUTES: Routes = [
  {
    path: '',
    pathMatch: 'full',
    loadComponent: () =>
      import('./health/health-page').then((m) => m.HealthPage),
    title: 'Health · Life Island',
  },
];
