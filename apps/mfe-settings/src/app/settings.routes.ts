import type { Routes } from '@angular/router';

/** What this remote exposes as `./routes`; the shell mounts it at /settings. */
export const SETTINGS_ROUTES: Routes = [
  {
    path: '',
    loadComponent: () =>
      import('./settings/settings-page').then((m) => m.SettingsPage),
    children: [
      { path: '', pathMatch: 'full', redirectTo: 'app' },
      {
        path: 'app',
        loadComponent: () =>
          import('./settings/app-settings').then((m) => m.AppSettingsPage),
        title: 'App settings · Life Island',
      },
      {
        path: 'ai-tools',
        loadComponent: () =>
          import('./settings/ai-tools').then((m) => m.AiToolsPage),
        title: 'AI tools · Life Island',
      },
    ],
  },
];
