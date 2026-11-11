import { provideHttpClient, withFetch } from '@angular/common/http';
import {
  ApplicationConfig,
  provideBrowserGlobalErrorListeners,
} from '@angular/core';
import { provideRouter, withComponentInputBinding } from '@angular/router';
import { GOALS_ROUTES } from './goals.routes';

/** Standalone mode: the Goals & habits module on its own, at the root. */
export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideHttpClient(withFetch()),
    provideRouter(GOALS_ROUTES, withComponentInputBinding()),
  ],
};
