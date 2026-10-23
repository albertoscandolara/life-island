import { Route } from '@angular/router';

/** Exposed to the shell as this remote's routes once Native Federation is set up. */
export const appRoutes: Route[] = [
  {
    path: '',
    loadComponent: () => import('./inbox/inbox-page').then((m) => m.InboxPage),
    title: 'Review inbox · Life Island',
  },
];
