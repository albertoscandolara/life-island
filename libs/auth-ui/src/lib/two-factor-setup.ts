import {
  ChangeDetectionStrategy,
  Component,
  inject,
  output,
  signal,
} from '@angular/core';
import {
  UiAlert,
  UiButton,
  UiFormField,
  UiInput,
} from '@life-island/design-system';
import { AuthState, authError } from './auth-api';

/** Pairs an authenticator app: the key to type (or the link to open), then a code to prove it works. */
@Component({
  selector: 'li-two-factor-setup',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [UiAlert, UiButton, UiFormField, UiInput],
  template: `
    @if (!secret()) {
      <button uiButton type="button" [loading]="busy()" (click)="start()">
        Set up the authenticator app
      </button>
    } @else {
      <form class="pair" (submit)="confirm($event)">
        <ol class="pair__steps">
          <li>
            Open an authenticator app (Google Authenticator, Microsoft
            Authenticator, 1Password, Aegis…).
          </li>
          <li>
            Add an account by key and type this one, or
            <a [href]="link()">open it in the app</a> on this phone:
            <code class="pair__key">{{ grouped() }}</code>
          </li>
          <li>Enter the 6-digit code the app shows.</li>
        </ol>
        <ui-form-field label="Code">
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
        @if (error()) {
          <ui-alert tone="danger">{{ error() }}</ui-alert>
        }
        <button uiButton type="submit" [loading]="busy()">
          Turn on two-factor sign-in
        </button>
      </form>
    }
    @if (!secret() && error()) {
      <ui-alert tone="danger">{{ error() }}</ui-alert>
    }
  `,
  styles: `
    :host {
      display: grid;
      gap: var(--space-4);
      text-align: start;
    }
    .pair {
      display: grid;
      gap: var(--space-4);
    }
    .pair__steps {
      display: grid;
      gap: var(--space-2);
      padding-inline-start: var(--space-5);
      font-size: var(--text-sm);
    }
    .pair__key {
      display: block;
      margin-top: var(--space-2);
      font-size: var(--text-md);
      letter-spacing: 0.08em;
      word-break: break-all;
    }
  `,
})
export class TwoFactorSetup {
  private readonly auth = inject(AuthState);
  readonly done = output<void>();

  protected readonly secret = signal('');
  protected readonly link = signal('');
  protected readonly code = signal('');
  protected readonly busy = signal(false);
  protected readonly error = signal('');

  protected grouped(): string {
    return this.secret()
      .replace(/(.{4})/g, '$1 ')
      .trim();
  }

  protected value(event: Event): string {
    return (event.target as HTMLInputElement).value;
  }

  protected async start(): Promise<void> {
    this.busy.set(true);
    this.error.set('');
    try {
      const pairing = await this.auth.startTwoFactor();
      this.secret.set(pairing.secret);
      this.link.set(pairing.otpauthUrl);
    } catch (error) {
      this.error.set(authError(error));
    } finally {
      this.busy.set(false);
    }
  }

  protected async confirm(event: Event): Promise<void> {
    event.preventDefault();
    this.busy.set(true);
    this.error.set('');
    try {
      await this.auth.confirmTwoFactor(this.code());
      this.done.emit();
    } catch (error) {
      this.error.set(authError(error));
    } finally {
      this.busy.set(false);
    }
  }
}
