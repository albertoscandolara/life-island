import { loadRemoteModule } from '@angular-architects/native-federation';
import type { Route, Routes } from '@angular/router';
import { ModuleUnavailable } from './module-unavailable';

/**
 * Loads an area's routes from its remote (apps/mfe-<area>), found at runtime
 * through public/federation.manifest.json, so each area deploys on its own.
 */
function remote(
  name: string,
  exposed: string,
  routes: string,
): Route['loadChildren'] {
  return () =>
    loadRemoteModule(name, exposed)
      .then((module: Record<string, Routes>) => module[routes])
      .catch((error: unknown) => {
        console.error(`Could not load ${name}`, error);
        return [{ path: '**', component: ModuleUnavailable }];
      });
}

export const appRoutes: Route[] = [
  {
    path: '',
    pathMatch: 'full',
    loadComponent: () => import('./hub/hub-page').then((m) => m.HubPage),
    title: 'Life Island',
  },
  { path: 'taxes', pathMatch: 'full', redirectTo: 'taxes/730' },
  {
    path: 'taxes/730',
    loadChildren: remote('mfe-tax730', './routes', 'TAX730_ROUTES'),
  },
  // Houses, with their renovations and bills: one remote, one service.
  {
    path: 'home',
    loadChildren: remote('mfe-home', './routes', 'HOME_ROUTES'),
  },
  { path: 'houses', pathMatch: 'full', redirectTo: 'home' },
  { path: 'bills', pathMatch: 'full', redirectTo: 'home/bills' },
  {
    path: 'people',
    loadChildren: remote('mfe-people', './routes', 'PEOPLE_ROUTES'),
  },
  {
    path: 'cars',
    loadChildren: remote('mfe-cars', './routes', 'CARS_ROUTES'),
  },
  { path: '**', redirectTo: '' },
];
