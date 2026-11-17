import {
  HttpErrorResponse,
  type HttpInterceptorFn,
} from '@angular/common/http';
import { inject } from '@angular/core';
import {
  Router,
  type CanActivateChildFn,
  type CanActivateFn,
} from '@angular/router';
import { catchError, throwError } from 'rxjs';
import { AUTH_API, AuthState } from './auth-api';

/** The page that signs you in, in both apps. */
export const SIGN_IN_PATH = 'sign-in';

/**
 * Lets a page open only for a signed-in person whose sign-in is complete;
 * everyone else lands on the sign-in page, which brings them back after.
 */
export const signInGuard: CanActivateFn & CanActivateChildFn = async (
  _route,
  state,
) => {
  const auth = inject(AuthState);
  const router = inject(Router);
  const session = await auth.load();
  if (session?.ready) return true;
  return router.createUrlTree([`/${SIGN_IN_PATH}`], {
    queryParams: { next: state.url === '/' ? null : state.url },
  });
};

/**
 * A 401 from any service means the session ended (expired, signed out in
 * another tab, removed by the owner): back to the sign-in page.
 */
export const signInInterceptor: HttpInterceptorFn = (request, next) => {
  const auth = inject(AuthState);
  const router = inject(Router);
  return next(request).pipe(
    catchError((error: unknown) => {
      if (
        error instanceof HttpErrorResponse &&
        error.status === 401 &&
        !request.url.startsWith(AUTH_API) &&
        !router.url.startsWith(`/${SIGN_IN_PATH}`)
      ) {
        auth.forget();
        void router.navigate([`/${SIGN_IN_PATH}`], {
          queryParams: { next: router.url },
        });
      }
      return throwError(() => error);
    }),
  );
};

/** Only a same-app path, never another site: `next` comes from the address bar. */
export function safeNext(next: string | null | undefined): string {
  return next &&
    next.startsWith('/') &&
    !next.startsWith('//') &&
    !next.startsWith(`/${SIGN_IN_PATH}`)
    ? next
    : '/';
}
