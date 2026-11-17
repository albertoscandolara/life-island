import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
} from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import {
  UiAlert,
  UiButton,
  UiCard,
  UiFormField,
  UiInput,
} from '@life-island/design-system';
import { AuthState, authError } from './auth-api';
import { safeNext } from './sign-in-guard';
import { TwoFactorSetup } from './two-factor-setup';

type Step = 'loading' | 'setup' | 'sign-in' | 'code' | 'invite' | 'two-factor';

/**
 * The door of the island: sign in (with the two-factor code when it is on),
 * create the owner account at the very first visit, accept an invite, or set
 * up the two-factor app when the island requires it.
 */
@Component({
  selector: 'li-sign-in-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [UiAlert, UiButton, UiCard, UiFormField, UiInput, TwoFactorSetup],
  template: `
    <section class="door">
      <p class="door__mark" aria-hidden="true">🏝️</p>
      <h1 class="door__title">{{ title() }}</h1>
      <ui-card>
        @switch (step()) {
          @case ('loading') {
            <p class="door__hint">Checking who you are…</p>
          }
          @case ('setup') {
            <form class="door__form" (submit)="setup($event)">
              <p class="door__hint">
                Nobody has an account on this island yet. Create the owner's
                with the setup code from the server (AUTH_SETUP_TOKEN).
              </p>
              <ui-form-field label="Setup code">
                <input
                  uiInput
                  name="token"
                  type="password"
                  autocomplete="off"
                  required
                  (input)="token.set(value($event))"
                />
              </ui-form-field>
              <ui-form-field label="Your name">
                <input
                  uiInput
                  name="name"
                  autocomplete="name"
                  required
                  (input)="name.set(value($event))"
                />
              </ui-form-field>
              <ui-form-field label="Email">
                <input
                  uiInput
                  name="email"
                  type="email"
                  autocomplete="username"
                  required
                  (input)="email.set(value($event))"
                />
              </ui-form-field>
              <ui-form-field
                label="Password"
                hint="At least 12 characters; a few words in a row are easy to remember."
              >
                <input
                  uiInput
                  name="password"
                  type="password"
                  autocomplete="new-password"
                  required
                  (input)="password.set(value($event))"
                />
              </ui-form-field>
              @if (error()) {
                <ui-alert tone="danger">{{ error() }}</ui-alert>
              }
              <button uiButton type="submit" [loading]="busy()">
                Create the owner account
              </button>
            </form>
          }
          @case ('invite') {
            <form class="door__form" (submit)="acceptInvite($event)">
              <p class="door__hint">
                You were invited as <strong>{{ inviteEmail() }}</strong
                >. Choose your name and a password.
              </p>
              <ui-form-field label="Your name">
                <input
                  uiInput
                  name="name"
                  autocomplete="name"
                  required
                  (input)="name.set(value($event))"
                />
              </ui-form-field>
              <ui-form-field
                label="Password"
                hint="At least 12 characters; a few words in a row are easy to remember."
              >
                <input
                  uiInput
                  name="password"
                  type="password"
                  autocomplete="new-password"
                  required
                  (input)="password.set(value($event))"
                />
              </ui-form-field>
              @if (error()) {
                <ui-alert tone="danger">{{ error() }}</ui-alert>
              }
              <button uiButton type="submit" [loading]="busy()">
                Join the island
              </button>
            </form>
          }
          @case ('two-factor') {
            <p class="door__hint">
              This island asks for a code from an authenticator app at every
              sign-in. Set it up once to go on.
            </p>
            <li-two-factor-setup (done)="finish()" />
          }
          @default {
            <form class="door__form" (submit)="signIn($event)">
              @if (step() === 'sign-in') {
                <ui-form-field label="Email">
                  <input
                    uiInput
                    name="email"
                    type="email"
                    autocomplete="username"
                    required
                    [value]="email()"
                    (input)="email.set(value($event))"
                  />
                </ui-form-field>
                <ui-form-field label="Password">
                  <input
                    uiInput
                    name="password"
                    type="password"
                    autocomplete="current-password"
                    required
                    (input)="password.set(value($event))"
                  />
                </ui-form-field>
              } @else {
                <ui-form-field
                  label="Code from your authenticator app"
                  hint="6 digits; a new one every 30 seconds."
                >
                  <input
                    uiInput
                    name="code"
                    inputmode="numeric"
                    autocomplete="one-time-code"
                    maxlength="7"
                    required
                    (input)="code.set(value($event))"
                  />
                </ui-form-field>
              }
              @if (error()) {
                <ui-alert tone="danger">{{ error() }}</ui-alert>
              }
              <button uiButton type="submit" [loading]="busy()">
                {{ step() === 'code' ? 'Check the code' : 'Sign in' }}
              </button>
            </form>
          }
        }
      </ui-card>
    </section>
  `,
  styles: `
    :host {
      display: block;
    }
    .door {
      max-width: 26rem;
      margin: var(--space-8) auto;
      padding-inline: var(--space-4);
      display: grid;
      gap: var(--space-4);
      text-align: center;
    }
    .door__mark {
      font-size: var(--text-3xl);
    }
    .door__title {
      font-family: var(--font-display);
      font-size: var(--text-2xl);
    }
    .door__form {
      display: grid;
      gap: var(--space-4);
      text-align: start;
    }
    .door__hint {
      color: var(--text-secondary);
      font-size: var(--text-sm);
      text-align: start;
    }
  `,
})
export class SignInPage {
  private readonly auth = inject(AuthState);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  protected readonly step = signal<Step>('loading');
  protected readonly busy = signal(false);
  protected readonly error = signal('');
  protected readonly email = signal('');
  protected readonly password = signal('');
  protected readonly name = signal('');
  protected readonly token = signal('');
  protected readonly code = signal('');
  protected readonly inviteEmail = signal('');

  protected readonly title = computed(() => {
    switch (this.step()) {
      case 'setup':
        return 'Welcome to your island';
      case 'invite':
        return 'Join the island';
      case 'two-factor':
        return 'One more step';
      default:
        return 'Sign in to Life Island';
    }
  });

  private readonly inviteToken =
    this.route.snapshot.queryParamMap.get('invite');

  constructor() {
    void this.start();
  }

  private async start(): Promise<void> {
    if (this.inviteToken) {
      try {
        this.inviteEmail.set(
          (await this.auth.checkInvite(this.inviteToken)).email,
        );
        this.step.set('invite');
      } catch (error) {
        this.error.set(authError(error));
        this.step.set('sign-in');
      }
      return;
    }
    const session = await this.auth.load(true);
    if (session?.ready) return this.finish();
    if (session) return this.step.set('two-factor');
    const setup = await this.auth
      .setupNeeded()
      .catch(() => ({ needed: false }));
    this.step.set(setup.needed ? 'setup' : 'sign-in');
  }

  protected value(event: Event): string {
    return (event.target as HTMLInputElement).value;
  }

  protected signIn(event: Event): Promise<void> {
    event.preventDefault();
    return this.run(async () => {
      const { needsCode } = await this.auth.signIn({
        email: this.email(),
        password: this.password(),
        code: this.step() === 'code' ? this.code() : undefined,
      });
      if (needsCode) return this.step.set('code');
      await this.afterSignIn();
    });
  }

  protected setup(event: Event): Promise<void> {
    event.preventDefault();
    return this.run(async () => {
      await this.auth.setup({
        token: this.token(),
        email: this.email(),
        name: this.name(),
        password: this.password(),
      });
      await this.afterSignIn();
    });
  }

  protected acceptInvite(event: Event): Promise<void> {
    event.preventDefault();
    return this.run(async () => {
      await this.auth.acceptInvite({
        token: this.inviteToken ?? '',
        name: this.name(),
        password: this.password(),
      });
      await this.afterSignIn();
    });
  }

  private async afterSignIn(): Promise<void> {
    const session = this.auth.session();
    if (session && !session.ready) return this.step.set('two-factor');
    await this.finish();
  }

  protected async finish(): Promise<void> {
    await this.router.navigateByUrl(
      safeNext(this.route.snapshot.queryParamMap.get('next')),
      { replaceUrl: true },
    );
  }

  private async run(work: () => Promise<void>): Promise<void> {
    this.busy.set(true);
    this.error.set('');
    try {
      await work();
    } catch (error) {
      this.error.set(authError(error));
      // A wrong code starts over from the password: the server needs both again.
      if (
        this.step() === 'code' &&
        (error as { status?: number }).status !== 401
      )
        this.step.set('sign-in');
    } finally {
      this.busy.set(false);
    }
  }
}
