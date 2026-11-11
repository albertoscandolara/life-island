import type { Routes } from '@angular/router';

/** What this remote exposes as `./routes`; the shell mounts it at /agenda. */
export const AGENDA_ROUTES: Routes = [
  {
    path: '',
    pathMatch: 'full',
    loadComponent: () =>
      import('./agenda/agenda-page').then((m) => m.AgendaPage),
    title: 'Agenda · Life Island',
  },
];
