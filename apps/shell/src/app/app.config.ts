import {
  provideHttpClient,
  withFetch,
  withInterceptors,
} from '@angular/common/http';
import { signInInterceptor } from '@life-island/auth-ui';
import {
  ApplicationConfig,
  provideBrowserGlobalErrorListeners,
} from '@angular/core';
import { provideRouter, withComponentInputBinding } from '@angular/router';
import { appRoutes } from './app.routes';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    // The areas' remotes call their services with the host's HttpClient.
    // A 401 from any area sends you back to the sign-in page.
    provideHttpClient(withFetch(), withInterceptors([signInInterceptor])),
    provideRouter(appRoutes, withComponentInputBinding()),
  ],
};
