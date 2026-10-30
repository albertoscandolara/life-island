import { Route } from '@angular/router';

export const appRoutes: Route[] = [
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
