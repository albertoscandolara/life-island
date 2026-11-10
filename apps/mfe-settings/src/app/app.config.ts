import { provideHttpClient, withFetch } from '@angular/common/http';
import {
  ApplicationConfig,
  provideBrowserGlobalErrorListeners,
} from '@angular/core';
import { provideRouter, withComponentInputBinding } from '@angular/router';
import { SETTINGS_ROUTES } from './settings.routes';

/** Standalone mode: the Settings module on its own, at the root. */
export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideHttpClient(withFetch()),
    provideRouter(SETTINGS_ROUTES, withComponentInputBinding()),
  ],
};
