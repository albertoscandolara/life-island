import { provideHttpClient, withInterceptors } from '@angular/common/http';
import {
  ApplicationConfig,
  provideBrowserGlobalErrorListeners,
} from '@angular/core';
import { provideRouter, withComponentInputBinding } from '@angular/router';
import { ENTITY_LINK_BASE } from '@life-island/entities-ui';
import { AI_TOOLS_SETTINGS_URL } from '@life-island/settings-ui';
import { environment } from '../environments/environment';
import { appRoutes } from './app.routes';
import { reclassificationLockInterceptor } from './reclassification/reclassification-state';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideHttpClient(withInterceptors([reclassificationLockInterceptor])),
    provideRouter(appRoutes, withComponentInputBinding()),
    // Settings lives in the Life Island app.
    {
      provide: AI_TOOLS_SETTINGS_URL,
      useValue: `${environment.shellUrl}settings/ai-tools`,
    },
    // People, houses, cars and companies have their pages there too.
    { provide: ENTITY_LINK_BASE, useValue: environment.shellUrl },
  ],
};
