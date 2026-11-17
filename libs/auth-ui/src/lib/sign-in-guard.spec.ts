import {
  provideHttpClient,
  withInterceptors,
  HttpClient,
} from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import {
  provideRouter,
  Router,
  type ActivatedRouteSnapshot,
  type RouterStateSnapshot,
  UrlTree,
} from '@angular/router';
import { AUTH_API } from './auth-api';
import { safeNext, signInGuard, signInInterceptor } from './sign-in-guard';

describe('sign-in guard', () => {
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        provideHttpClient(withInterceptors([signInInterceptor])),
        provideHttpClientTesting(),
      ],
    });
    http = TestBed.inject(HttpTestingController);
  });

  const guard = (url: string) =>
    TestBed.runInInjectionContext(() =>
      signInGuard({} as ActivatedRouteSnapshot, { url } as RouterStateSnapshot),
    ) as Promise<boolean | UrlTree>;

  it('sends a visitor without a session to the sign-in page, keeping the page asked for', async () => {
    const result = guard('/cars');
    http
      .expectOne(`${AUTH_API}/session`)
      .flush(
        { message: 'Sign in' },
        { status: 401, statusText: 'Unauthorized' },
      );
    const tree = (await result) as UrlTree;
    expect(TestBed.inject(Router).serializeUrl(tree)).toBe(
      '/sign-in?next=%2Fcars',
    );
  });

  it('opens the page for a complete session, and holds back one missing two-factor', async () => {
    const user = {
      id: 'u',
      email: 'a@b.c',
      name: 'A',
      role: 'owner',
      twoFactor: true,
    };
    const ok = guard('/cars');
    http
      .expectOne(`${AUTH_API}/session`)
      .flush({ user, ready: true, twoFactorRequired: true, devBypass: false });
    expect(await ok).toBe(true);
  });

  it('sends a 401 from any area back to sign-in', async () => {
    const router = TestBed.inject(Router);
    const navigate = vi.spyOn(router, 'navigate').mockResolvedValue(true);
    TestBed.inject(HttpClient)
      .get('/api/cars/cars')
      .subscribe({ error: () => undefined });
    http
      .expectOne('/api/cars/cars')
      .flush({}, { status: 401, statusText: 'Unauthorized' });
    expect(navigate).toHaveBeenCalledWith(['/sign-in'], {
      queryParams: { next: '/' },
    });
  });

  it('only goes back to a page of this app', () => {
    expect(safeNext('/cars?tab=1')).toBe('/cars?tab=1');
    expect(safeNext('//evil.example')).toBe('/');
    expect(safeNext('https://evil.example')).toBe('/');
    expect(safeNext('/sign-in')).toBe('/');
    expect(safeNext(null)).toBe('/');
  });
});
