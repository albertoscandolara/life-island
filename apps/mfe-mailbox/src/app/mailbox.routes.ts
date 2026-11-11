import type { Routes } from '@angular/router';

/** What this remote exposes as `./routes`; the shell mounts it at /mailbox. */
export const MAILBOX_ROUTES: Routes = [
  {
    path: '',
    pathMatch: 'full',
    loadComponent: () =>
      import('./mailbox/mailbox-page').then((m) => m.MailboxPage),
    title: 'Admin mailbox · Life Island',
  },
];
