import { Route } from '@angular/router';

/**
 * Domain modules (mfe-groceries, mfe-tax730) are added here as Native
 * Federation remotes once they exist, e.g.
 * `{ path: 'groceries', loadChildren: () => loadRemoteModule('mfe-groceries', './routes') }`.
 */
export const appRoutes: Route[] = [
  {
    path: '',
    pathMatch: 'full',
    loadComponent: () => import('./hub/hub-page').then((m) => m.HubPage),
    title: 'Life Island',
  },
  { path: '**', redirectTo: '' },
];
