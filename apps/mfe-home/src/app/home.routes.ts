import type { Routes } from '@angular/router';

/**
 * What this remote exposes as `./routes`; the shell mounts it at /home.
 * Home (properties, renovations and repairs) at the root, Bills beside it.
 */
export const HOME_ROUTES: Routes = [
  {
    path: '',
    pathMatch: 'full',
    loadComponent: () => import('./home/home-page').then((m) => m.HomePage),
    title: 'Home · Life Island',
  },
  {
    path: 'bills',
    loadComponent: () => import('./bills/bills-page').then((m) => m.BillsPage),
    title: 'Bills · Life Island',
  },
];
