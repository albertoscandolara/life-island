import { DatePipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  inject,
  signal,
} from '@angular/core';
import { Router } from '@angular/router';
import {
  UiAlert,
  UiButton,
  UiCard,
  UiFormField,
  UiInput,
  UiPageHeader,
} from '@life-island/design-system';
import {
  AuthState,
  authError,
  type AuthInvite,
  type AuthMember,
} from './auth-api';
import { SIGN_IN_PATH } from './sign-in-guard';
import { TwoFactorSetup } from './two-factor-setup';

/**
 * Your account: sign out (here or everywhere), password, two-factor sign-in,
 * and for the owner the people of the island and their invites.
 */
@Component({
  selector: 'li-account-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    DatePipe,
    UiAlert,
    UiButton,
    UiCard,
    UiFormField,
    UiInput,
    UiPageHeader,
    TwoFactorSetup,
  ],
  template: `
    <ui-page-header
      heading="Your account"
      emblem="🔐"
      [subtitle]="auth.user()?.email ?? ''"
    />
    <div class="account">
      @if (auth.session()?.devBypass) {
        <ui-alert tone="warning">
          Sign-in is skipped on this machine (AUTH_DEV_BYPASS). Turn it off to
          try the real sign-in.
        </ui-alert>
      }
      @if (notice()) {
        <ui-alert tone="success">{{ notice() }}</ui-alert>
      }

      <ui-card heading="Sign out">
        <div class="row">
          <button
            uiButton
            variant="secondary"
            type="button"
            (click)="signOut(false)"
          >
            Sign out
          </button>
          <button
            uiButton
            variant="ghost"
            type="button"
            (click)="signOut(true)"
          >
            Sign out on every device
          </button>
        </div>
      </ui-card>

      <ui-card heading="Two-factor sign-in">
        @if (auth.user()?.twoFactor) {
          <p class="hint">
            On: every sign-in asks for a code from your authenticator app.
          </p>
          @if (!auth.session()?.twoFactorRequired) {
            <form class="form" (submit)="disableTwoFactor($event)">
              <ui-form-field label="Password">
                <input
                  uiInput
                  type="password"
                  autocomplete="current-password"
                  (input)="tfPassword.set(value($event))"
                />
              </ui-form-field>
              <ui-form-field label="Code">
                <input
                  uiInput
                  inputmode="numeric"
                  autocomplete="one-time-code"
                  maxlength="7"
                  (input)="tfCode.set(value($event))"
                />
              </ui-form-field>
              <button uiButton variant="danger" type="submit">
                Turn off two-factor sign-in
              </button>
            </form>
          }
        } @else {
          <p class="hint">
            Off. Turn it on so a stolen password alone cannot open your
            documents.
          </p>
          <li-two-factor-setup (done)="said('Two-factor sign-in is on.')" />
        }
      </ui-card>

      <ui-card heading="Password">
        <form class="form" (submit)="changePassword($event)">
          <ui-form-field label="Current password">
            <input
              uiInput
              type="password"
              autocomplete="current-password"
              (input)="current.set(value($event))"
            />
          </ui-form-field>
          <ui-form-field
            label="New password"
            hint="At least 12 characters. Other devices are signed out."
          >
            <input
              uiInput
              type="password"
              autocomplete="new-password"
              (input)="next.set(value($event))"
            />
          </ui-form-field>
          <button uiButton type="submit">Change password</button>
        </form>
      </ui-card>

      @if (auth.isOwner() && !auth.session()?.devBypass) {
        <ui-card heading="People of the island">
          <ul class="list">
            @for (member of members(); track member.id) {
              <li class="list__row">
                <span>
                  <strong>{{ member.name }}</strong> · {{ member.email }} ·
                  {{ member.role }}
                  @if (!member.twoFactor) {
                    · no two-factor
                  }
                  <br />
                  <small class="hint"
                    >Last sign-in:
                    {{
                      member.lastLoginAt
                        ? (member.lastLoginAt | date: 'medium')
                        : 'never'
                    }}</small
                  >
                </span>
                @if (member.id !== auth.user()?.id) {
                  <button
                    uiButton
                    variant="danger"
                    size="sm"
                    type="button"
                    (click)="remove(member)"
                  >
                    Remove
                  </button>
                }
              </li>
            }
          </ul>
          <form class="form form--inline" (submit)="invite($event)">
            <ui-form-field
              label="Invite by email"
              hint="They get a one-time link, valid 7 days. They see the whole island."
            >
              <input
                uiInput
                type="email"
                autocomplete="off"
                [value]="inviteEmail()"
                (input)="inviteEmail.set(value($event))"
              />
            </ui-form-field>
            <button uiButton type="submit">Create invite link</button>
          </form>
          @if (inviteLink()) {
            <ui-alert tone="info">
              Send this link yourself; it is shown only now:
              <code class="link">{{ inviteLink() }}</code>
            </ui-alert>
          }
          @if (invites().length) {
            <ul class="list">
              @for (pending of invites(); track pending.id) {
                <li class="list__row">
                  <span
                    >{{ pending.email }} · until
                    {{ pending.expiresAt | date: 'mediumDate' }}</span
                  >
                  <button
                    uiButton
                    variant="ghost"
                    size="sm"
                    type="button"
                    (click)="cancel(pending)"
                  >
                    Cancel
                  </button>
                </li>
              }
            </ul>
          }
        </ui-card>
      }

      @if (error()) {
        <ui-alert tone="danger">{{ error() }}</ui-alert>
      }
    </div>
  `,
  styles: `
    .account {
      display: grid;
      gap: var(--space-5);
      max-width: 44rem;
    }
    .row {
      display: flex;
      flex-wrap: wrap;
      gap: var(--space-3);
    }
    .form {
      display: grid;
      gap: var(--space-4);
      max-width: 26rem;
    }
    .hint {
      color: var(--text-secondary);
      font-size: var(--text-sm);
    }
    .list {
      display: grid;
      padding: 0;
      list-style: none;
      gap: var(--space-3);
      margin-bottom: var(--space-4);
    }
    .list__row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: var(--space-3);
    }
    .link {
      display: block;
      margin-top: var(--space-2);
      word-break: break-all;
    }
  `,
})
export class AccountPage {
  protected readonly auth = inject(AuthState);
  private readonly router = inject(Router);

  protected readonly members = signal<AuthMember[]>([]);
  protected readonly invites = signal<AuthInvite[]>([]);
  protected readonly inviteEmail = signal('');
  protected readonly inviteLink = signal('');
  protected readonly current = signal('');
  protected readonly next = signal('');
  protected readonly tfPassword = signal('');
  protected readonly tfCode = signal('');
  protected readonly notice = signal('');
  protected readonly error = signal('');

  constructor() {
    void this.refresh();
  }

  protected value(event: Event): string {
    return (event.target as HTMLInputElement).value;
  }

  protected said(message: string): void {
    this.error.set('');
    this.notice.set(message);
  }

  private async refresh(): Promise<void> {
    if (!this.auth.isOwner() || this.auth.session()?.devBypass) return;
    await this.attempt(async () => {
      const [members, invites] = await Promise.all([
        this.auth.members(),
        this.auth.invites(),
      ]);
      this.members.set(members);
      this.invites.set(invites);
    });
  }

  protected async signOut(everywhere: boolean): Promise<void> {
    await this.auth.signOut(everywhere);
    await this.router.navigate([`/${SIGN_IN_PATH}`]);
  }

  protected changePassword(event: Event): Promise<void> {
    event.preventDefault();
    return this.attempt(async () => {
      await this.auth.changePassword(this.current(), this.next());
      this.said('Password changed. Other devices were signed out.');
    });
  }

  protected disableTwoFactor(event: Event): Promise<void> {
    event.preventDefault();
    return this.attempt(async () => {
      await this.auth.disableTwoFactor(this.tfPassword(), this.tfCode());
      this.said('Two-factor sign-in is off.');
    });
  }

  protected invite(event: Event): Promise<void> {
    event.preventDefault();
    return this.attempt(async () => {
      const { token } = await this.auth.invite(this.inviteEmail(), 'member');
      this.inviteLink.set(
        new URL(`${SIGN_IN_PATH}?invite=${token}`, document.baseURI).toString(),
      );
      this.inviteEmail.set('');
      this.invites.set(await this.auth.invites());
    });
  }

  protected cancel(invite: AuthInvite): Promise<void> {
    return this.attempt(async () => {
      await this.auth.cancelInvite(invite.id);
      this.invites.set(await this.auth.invites());
    });
  }

  protected remove(member: AuthMember): Promise<void> {
    return this.attempt(async () => {
      await this.auth.removeMember(member.id);
      this.members.set(await this.auth.members());
      this.said(`${member.name} can no longer sign in.`);
    });
  }

  private async attempt(work: () => Promise<void>): Promise<void> {
    this.error.set('');
    this.notice.set('');
    try {
      await work();
    } catch (error) {
      this.error.set(authError(error));
    }
  }
}
