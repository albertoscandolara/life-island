import { Route } from '@angular/router';
import { SIGN_IN_PATH, signInGuard } from '@life-island/auth-ui';

/** Every page of the documents app, open only once you are signed in. */
const documentRoutes: Route[] = [
  {
    path: '',
    pathMatch: 'full',
    loadComponent: () => import('./home/home-page').then((m) => m.HomePage),
    title: 'Documents · Life Island',
  },
  {
    path: 'upload',
    loadComponent: () =>
      import('./upload/upload-page').then((m) => m.UploadPage),
    title: 'Load documents · Life Island',
  },
  {
    path: 'review',
    loadComponent: () => import('./review/inbox-page').then((m) => m.InboxPage),
    title: 'Review documents · Life Island',
  },
  {
    path: 'categories',
    loadComponent: () =>
      import('./categories/categories-page').then((m) => m.CategoriesPage),
    title: 'Document categories · Life Island',
  },
  { path: '**', redirectTo: '' },
];

export const appRoutes: Route[] = [
  {
    path: SIGN_IN_PATH,
    loadComponent: () =>
      import('@life-island/auth-ui').then((m) => m.SignInPage),
    title: 'Sign in · Life Island',
  },
  { path: '', canActivateChild: [signInGuard], children: documentRoutes },
];
