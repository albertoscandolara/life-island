import type { Routes } from '@angular/router';

/** What this remote exposes as `./routes`; the shell mounts it at /cars. */
export const CARS_ROUTES: Routes = [
  {
    path: '',
    pathMatch: 'full',
    loadComponent: () => import('./cars/cars-page').then((m) => m.CarsPage),
    title: 'Cars · Life Island',
  },
];
