import type { Routes } from '@angular/router';

/**
 * What this remote exposes as `./companies`; the shell mounts it at
 * /companies, beside the areas rather than under Houses: every area names
 * companies (suppliers, employers, banks, insurers). svc-home keeps them.
 */
export const COMPANIES_ROUTES: Routes = [
  {
    path: '',
    pathMatch: 'full',
    loadComponent: () =>
      import('./companies/companies-page').then((m) => m.CompaniesPage),
    title: 'Companies · Life Island',
  },
];
