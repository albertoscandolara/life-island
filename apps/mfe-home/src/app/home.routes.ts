import type { Routes } from '@angular/router';

/**
 * What this remote exposes as `./routes`; the shell mounts it at /home.
 * Houses: each house itself at the root, its renovations and its bills beside it.
 */
export const HOME_ROUTES: Routes = [
  {
    path: '',
    pathMatch: 'full',
    loadComponent: () =>
      import('./houses/houses-page').then((m) => m.HousesPage),
    title: 'Houses · Life Island',
  },
  {
    path: 'renovations',
    loadComponent: () => import('./home/home-page').then((m) => m.HomePage),
    title: 'Renovations · Life Island',
  },
  {
    path: 'bills',
    loadComponent: () => import('./bills/bills-page').then((m) => m.BillsPage),
    title: 'Bills · Life Island',
  },
  {
    path: 'companies',
    loadComponent: () =>
      import('./companies/companies-page').then((m) => m.CompaniesPage),
    title: 'Companies · Life Island',
  },
];
