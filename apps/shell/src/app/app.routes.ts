import { loadRemoteModule } from '@angular-architects/native-federation';
import type { Route, Routes } from '@angular/router';
import { ModuleUnavailable } from './module-unavailable';

/**
 * Loads an area's routes from its remote (apps/mfe-<area>), found at runtime
 * through public/federation.manifest.json, so each area deploys on its own.
 *
 * initFederation (main.ts) reads every remote once, when the page opens. A
 * remote that was not up yet (its dev server still compiling, or started
 * after the shell) stays "not initialized" for the rest of the session, so on
 * failure the remote is registered again from the manifest and loaded once
 * more before the area is shown as unreachable.
 */
function remote(
  name: string,
  exposed: string,
  routes: string,
): Route['loadChildren'] {
  return () =>
    loadRemoteModule<Record<string, Routes>>(name, exposed)
      .catch(async () => {
        const remoteEntry = await manifestEntry(name);
        return loadRemoteModule<Record<string, Routes>>({
          remoteEntry,
          remoteName: name,
          exposedModule: exposed,
        });
      })
      .then((module) => module[routes])
      .catch((error: unknown) => {
        console.error(`Could not load ${name}`, error);
        return [{ path: '**', component: ModuleUnavailable }];
      });
}

/** The remoteEntry.json URL the manifest gives for a remote. */
async function manifestEntry(name: string): Promise<string> {
  const response = await fetch(
    new URL('federation.manifest.json', document.baseURI),
    {
      cache: 'no-store',
    },
  );
  const manifest = (await response.json()) as Record<string, string>;
  const entry = manifest[name];
  if (!entry) throw new Error(`${name} is not in federation.manifest.json`);
  return entry;
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
  {
    path: 'work',
    loadChildren: remote('mfe-work', './routes', 'WORK_ROUTES'),
  },
  {
    path: 'studies',
    loadChildren: remote('mfe-studies', './routes', 'STUDIES_ROUTES'),
  },
  {
    path: 'groceries',
    loadChildren: remote('mfe-groceries', './routes', 'GROCERIES_ROUTES'),
  },
  {
    path: 'agenda',
    loadChildren: remote('mfe-agenda', './routes', 'AGENDA_ROUTES'),
  },
  {
    path: 'money',
    loadChildren: remote('mfe-money', './routes', 'MONEY_ROUTES'),
  },
  {
    path: 'goals',
    loadChildren: remote('mfe-goals', './routes', 'GOALS_ROUTES'),
  },
  {
    path: 'health',
    loadChildren: remote('mfe-health', './routes', 'HEALTH_ROUTES'),
  },
  {
    path: 'subscriptions',
    loadChildren: remote('mfe-subscriptions', './routes', 'SUBSCRIPTIONS_ROUTES'),
  },
  {
    path: 'mailbox',
    loadChildren: remote('mfe-mailbox', './routes', 'MAILBOX_ROUTES'),
  },
  {
    path: 'travel',
    loadChildren: remote('mfe-travel', './routes', 'TRAVEL_ROUTES'),
  },
  {
    path: 'fitness',
    loadChildren: remote('mfe-fitness', './routes', 'FITNESS_ROUTES'),
  },
  {
    path: 'settings',
    loadChildren: remote('mfe-settings', './routes', 'SETTINGS_ROUTES'),
  },
  { path: '**', redirectTo: '' },
];
