import { provideHttpClient, withFetch } from '@angular/common/http';
import {
  ApplicationConfig,
  provideBrowserGlobalErrorListeners,
} from '@angular/core';
import { provideRouter, withComponentInputBinding } from '@angular/router';
import { FITNESS_ROUTES } from './fitness.routes';

/** Standalone mode: the Fitness module on its own, at the root. */
export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideHttpClient(withFetch()),
    provideRouter(FITNESS_ROUTES, withComponentInputBinding()),
  ],
};
