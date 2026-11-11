import type { Routes } from '@angular/router';

/** What this remote exposes as `./routes`; the shell mounts it at /subscriptions. */
export const SUBSCRIPTIONS_ROUTES: Routes = [
  {
    path: '',
    pathMatch: 'full',
    loadComponent: () =>
      import('./subscriptions/subscriptions-page').then((m) => m.SubscriptionsPage),
    title: 'Contracts & subscriptions · Life Island',
  },
];
