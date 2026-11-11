import { provideHttpClient, withFetch } from '@angular/common/http';
import {
  ApplicationConfig,
  provideBrowserGlobalErrorListeners,
} from '@angular/core';
import { provideRouter, withComponentInputBinding } from '@angular/router';
import { GROCERIES_ROUTES } from './groceries.routes';

/** Standalone mode: the Groceries module on its own, at the root. */
export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideHttpClient(withFetch()),
    provideRouter(GROCERIES_ROUTES, withComponentInputBinding()),
  ],
};
