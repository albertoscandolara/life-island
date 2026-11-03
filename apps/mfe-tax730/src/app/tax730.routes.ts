import type { Routes } from '@angular/router';

/** What this remote exposes as `./routes`; the shell mounts it at /taxes/730. */
export const TAX730_ROUTES: Routes = [
  {
    path: '',
    loadComponent: () =>
      import('./dashboard/dashboard-page').then((m) => m.DashboardPage),
    title: '730 · Life Island',
  },
];
