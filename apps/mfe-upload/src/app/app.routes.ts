import { Route } from '@angular/router';

/** Exposed to the shell as this remote's routes once Native Federation is set up. */
export const appRoutes: Route[] = [
  {
    path: '',
    loadComponent: () =>
      import('./upload/upload-page').then((m) => m.UploadPage),
    title: 'Upload documents · Life Island',
  },
];
