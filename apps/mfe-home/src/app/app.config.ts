import { provideHttpClient, withFetch } from '@angular/common/http';
import {
  ApplicationConfig,
  provideBrowserGlobalErrorListeners,
} from '@angular/core';
import { provideRouter, withComponentInputBinding } from '@angular/router';
import { COMPANIES_ROUTES } from './companies.routes';
import { HOME_ROUTES } from './home.routes';

/** Standalone mode: the Home module (Bills and Home) on its own, at the root; the companies at /companies, as in the shell. */
export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideHttpClient(withFetch()),
    provideRouter(
      [{ path: 'companies', children: COMPANIES_ROUTES }, ...HOME_ROUTES],
      withComponentInputBinding(),
    ),
  ],
};
