import type { Routes } from '@angular/router';

/** What this remote exposes as `./routes`; the shell mounts it at /work. */
export const WORK_ROUTES: Routes = [
  {
    path: '',
    pathMatch: 'full',
    loadComponent: () => import('./work/work-page').then((m) => m.WorkPage),
    title: 'Work · Life Island',
  },
];
