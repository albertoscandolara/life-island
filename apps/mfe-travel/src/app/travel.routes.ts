import type { Routes } from '@angular/router';

/** What this remote exposes as `./routes`; the shell mounts it at /travel. */
export const TRAVEL_ROUTES: Routes = [
  {
    path: '',
    pathMatch: 'full',
    loadComponent: () =>
      import('./travel/travel-page').then((m) => m.TravelPage),
    title: 'Travel · Life Island',
  },
];
