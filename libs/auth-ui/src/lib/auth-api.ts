import { HttpClient } from '@angular/common/http';
import { Injectable, computed, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';

/*
 * The island's sign-in, as the browser sees it (docs/security.md, "Sign-in").
 * The session lives in an HttpOnly cookie the page never reads: this service
 * only asks svc-auth who is signed in, and calls its routes. One instance per
 * app; the shell's is shared with every area remote through its HttpClient.
 */

export const AUTH_API = '/api/auth';

export interface AuthAccount {
  id: string;
  email: string;
  name: string;
  role: 'owner' | 'member';
  twoFactor: boolean;
}

export interface AuthSession {
  user: AuthAccount;
  /** False until a required two-factor app is set up. */
  ready: boolean;
  twoFactorRequired: boolean;
  /** Sign-in skipped on this machine (AUTH_DEV_BYPASS). */
  devBypass: boolean;
}

export interface AuthMember extends AuthAccount {
  lastLoginAt: string | null;
}

export interface AuthInvite {
  id: string;
  email: string;
  role: 'owner' | 'member';
  expiresAt: string;
}

/** The message of a failed call, as svc-auth words it. */
export function authError(error: unknown): string {
  const body = (error as { error?: { message?: unknown } } | null)?.error;
  const message = body?.message;
  if (typeof message === 'string') return message;
  if (Array.isArray(message)) return message.join(' ');
  return 'Something went wrong. Try again in a moment.';
}

@Injectable({ providedIn: 'root' })
export class AuthState {
  private readonly http = inject(HttpClient);
  private readonly current = signal<AuthSession | null>(null);
  private loading: Promise<AuthSession | null> | null = null;

  readonly session = this.current.asReadonly();
  readonly user = computed(() => this.current()?.user ?? null);
  readonly isOwner = computed(() => this.current()?.user.role === 'owner');

  /** Who is signed in, asked once and then remembered until sign-out or a 401. */
  load(force = false): Promise<AuthSession | null> {
    if (force || !this.loading)
      this.loading = firstValueFrom(
        this.http.get<AuthSession>(`${AUTH_API}/session`),
      )
        .then((session) => {
          this.current.set(session);
          return session;
        })
        .catch(() => {
          this.current.set(null);
          return null;
        });
    return this.loading;
  }

  /** Forgets the session (after a 401), so the next navigation asks again. */
  forget(): void {
    this.current.set(null);
    this.loading = null;
  }

  setupNeeded(): Promise<{ needed: boolean }> {
    return firstValueFrom(
      this.http.get<{ needed: boolean }>(`${AUTH_API}/setup`),
    );
  }

  async setup(body: {
    token: string;
    email: string;
    name: string;
    password: string;
  }): Promise<void> {
    await firstValueFrom(this.http.post(`${AUTH_API}/setup`, body));
    await this.load(true);
  }

  /** Signs in; `needsCode` asks for the two-factor code and a second call. */
  async signIn(body: {
    email: string;
    password: string;
    code?: string;
  }): Promise<{ needsCode: boolean }> {
    const answer = await firstValueFrom(
      this.http.post<{ needsCode?: boolean }>(`${AUTH_API}/login`, body),
    );
    if (answer.needsCode) return { needsCode: true };
    await this.load(true);
    return { needsCode: false };
  }

  async signOut(everywhere = false): Promise<void> {
    await firstValueFrom(
      this.http.post(
        `${AUTH_API}/${everywhere ? 'logout-everywhere' : 'logout'}`,
        {},
      ),
    ).catch(() => undefined);
    this.forget();
  }

  async changePassword(current: string, next: string): Promise<void> {
    await firstValueFrom(
      this.http.post(`${AUTH_API}/password`, { current, next }),
    );
  }

  startTwoFactor(): Promise<{ secret: string; otpauthUrl: string }> {
    return firstValueFrom(
      this.http.post<{ secret: string; otpauthUrl: string }>(
        `${AUTH_API}/two-factor/start`,
        {},
      ),
    );
  }

  async confirmTwoFactor(code: string): Promise<void> {
    await firstValueFrom(
      this.http.post(`${AUTH_API}/two-factor/confirm`, { code }),
    );
    await this.load(true);
  }

  async disableTwoFactor(password: string, code: string): Promise<void> {
    await firstValueFrom(
      this.http.post(`${AUTH_API}/two-factor/disable`, { password, code }),
    );
    await this.load(true);
  }

  members(): Promise<AuthMember[]> {
    return firstValueFrom(this.http.get<AuthMember[]>(`${AUTH_API}/members`));
  }

  async removeMember(id: string): Promise<void> {
    await firstValueFrom(
      this.http.delete(`${AUTH_API}/members/${encodeURIComponent(id)}`),
    );
  }

  invites(): Promise<AuthInvite[]> {
    return firstValueFrom(this.http.get<AuthInvite[]>(`${AUTH_API}/invites`));
  }

  invite(
    email: string,
    role: 'owner' | 'member',
  ): Promise<{ token: string; expiresAt: string }> {
    return firstValueFrom(
      this.http.post<{ token: string; expiresAt: string }>(
        `${AUTH_API}/invites`,
        { email, role },
      ),
    );
  }

  async cancelInvite(id: string): Promise<void> {
    await firstValueFrom(
      this.http.delete(`${AUTH_API}/invites/${encodeURIComponent(id)}`),
    );
  }

  checkInvite(token: string): Promise<{ email: string }> {
    return firstValueFrom(
      this.http.get<{ email: string }>(`${AUTH_API}/invite`, {
        params: { token },
      }),
    );
  }

  async acceptInvite(body: {
    token: string;
    name: string;
    password: string;
  }): Promise<void> {
    await firstValueFrom(this.http.post(`${AUTH_API}/invite/accept`, body));
    await this.load(true);
  }
}
