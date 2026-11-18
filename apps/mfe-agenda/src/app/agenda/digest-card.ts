import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
} from '@angular/core';
import { DomSanitizer, type SafeHtml } from '@angular/platform-browser';
import { RouterLink } from '@angular/router';
import {
  entityLink,
  type DigestDto,
  type DigestSendDto,
  type DigestStatusDto,
} from '@life-island/contracts';
import {
  UiAlert,
  UiBadge,
  UiButton,
  UiCard,
  UiIcon,
  type UiTone,
} from '@life-island/design-system';
import { EntityLink } from '@life-island/entities-ui';
import { dateText, errorText } from '@life-island/records-ui';
import { AgendaApi } from '../api/agenda-api';

const SERVICE = 'svc-agenda';

/** Settings opened on the digest's own settings. */
export const DIGEST_SETTINGS_LINK = {
  path: '/settings/app',
  query: { q: 'email digest' },
};

const SEND_BADGES: Record<
  DigestSendDto['status'],
  { tone: UiTone; text: string }
> = {
  sent: { tone: 'success', text: 'Sent' },
  empty: { tone: 'neutral', text: 'Nothing to say, not sent' },
  failed: { tone: 'danger', text: 'Not sent' },
  sending: { tone: 'info', text: 'Sending' },
};

/** "Mon 23 Nov at 07:30" from the island clock's `YYYY-MM-DDTHH:MM`. */
export function momentText(at: string): string {
  return `${dateText(at.slice(0, 10))} at ${at.slice(11, 16)}`;
}

/** What a send was for: "Daily, 18 Nov 2026", "Test, 18 Nov 2026". */
export function periodText(send: DigestSendDto): string {
  const [kind, rest] = send.period.split(/:(.*)/s);
  const label =
    { daily: 'Daily', weekly: 'Weekly', monthly: 'Monthly', test: 'Test' }[
      kind
    ] ?? kind;
  if (kind === 'monthly') return `${label}, ${rest}`;
  return `${label}, ${dateText(kind === 'test' ? send.at : rest)}`;
}

/**
 * The email digest on the Agenda: whether it goes, to whom and when; what is
 * in the way and where to fix it; a preview, a test sent now, and the last
 * sends. How often and to whom are set in Settings.
 */
@Component({
  selector: 'agenda-digest-card',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [EntityLink, RouterLink, UiAlert, UiBadge, UiButton, UiCard, UiIcon],
  styles: `
    .status {
      display: flex;
      flex-wrap: wrap;
      gap: var(--space-2) var(--space-3);
      align-items: baseline;
      margin: 0 0 var(--space-3);
    }
    .status strong {
      font-size: var(--text-lg);
    }
    .actions {
      display: flex;
      flex-wrap: wrap;
      gap: var(--space-2);
      margin-top: var(--space-3);
    }
    .preview {
      display: block;
      inline-size: 100%;
      block-size: 34rem;
      margin-top: var(--space-4);
      border: 1px solid var(--border);
      border-radius: var(--radius-md);
      background: #f4f1ea;
    }
    .sends {
      margin: var(--space-4) 0 0;
      padding: 0;
      list-style: none;
      display: grid;
      gap: var(--space-2);
    }
    .sends li {
      display: flex;
      flex-wrap: wrap;
      gap: var(--space-2);
      align-items: baseline;
    }
  `,
  template: `
    <ui-card heading="Email digest" class="li-block">
      <a
        uiCardActions
        uiButton
        variant="ghost"
        size="sm"
        [routerLink]="settings.path"
        [queryParams]="settings.query"
      >
        <ui-icon name="sliders" [size]="16" /> Change in Settings
      </a>
      <p class="li-intro li-muted">
        An email with what is overdue, what is coming and what waits for you in
        every area, each line linked to where you handle it. It is sent to a
        person of People, at the email on their page.
      </p>
      @if (error(); as message) {
        <ui-alert tone="danger" class="li-block">{{ message }}</ui-alert>
      }
      @if (status(); as s) {
        @if (!s.problem) {
          <p class="status">
            <ui-icon name="check" [size]="18" />
            <strong>{{ s.schedule }}</strong>
            <span
              >to
              <li-entity-link
                kind="person"
                [entityId]="s.recipient!.id"
                [name]="s.recipient!.name"
              />
              <span class="li-muted"> · {{ s.recipient!.email }}</span></span
            >
            @if (s.next) {
              <span class="li-muted">Next: {{ moment(s.next) }}</span>
            }
          </p>
        } @else {
          <ui-alert [tone]="s.problem === 'off' ? 'info' : 'warning'">
            @switch (s.problem) {
              @case ('off') {
                The digest is off. Choose every day, week or month, and who gets
                it.
                <a
                  uiButton
                  size="sm"
                  [routerLink]="settings.path"
                  [queryParams]="settings.query"
                  >Turn it on</a
                >
              }
              @case ('no-recipient') {
                {{ s.schedule }}, but nobody is picked to receive it.
                <a
                  uiButton
                  size="sm"
                  [routerLink]="settings.path"
                  [queryParams]="settings.query"
                  >Pick who gets it</a
                >
              }
              @case ('no-email') {
                <li-entity-link
                  kind="person"
                  [entityId]="s.recipient!.id"
                  [name]="s.recipient!.name"
                />
                has no email yet, so the digest cannot go.
                <a
                  uiButton
                  size="sm"
                  [routerLink]="personLink(s.recipient!.id).path"
                  [queryParams]="personLink(s.recipient!.id).query"
                  >Add the email in People</a
                >
              }
              @case ('recipient-missing') {
                The person picked is no longer in People.
                <a
                  uiButton
                  size="sm"
                  [routerLink]="settings.path"
                  [queryParams]="settings.query"
                  >Pick someone else</a
                >
              }
              @case ('people-down') {
                People could not be reached, so the address is unknown right
                now. Is svc-people running?
                <button uiButton size="sm" type="button" (click)="load()">
                  Try again
                </button>
              }
              @case ('no-mail') {
                Email is not set up on the server yet: set SMTP_URL (and
                MAIL_FROM) in .env and restart svc-agenda. Locally,
                <code>npm run infra:up</code> starts a mail catcher at
                localhost:8025.
              }
            }
          </ui-alert>
        }
        <div class="actions">
          <button
            uiButton
            variant="secondary"
            type="button"
            [loading]="busy() === 'preview'"
            [disabled]="busy() !== null"
            (click)="togglePreview()"
          >
            <ui-icon name="eye" [size]="16" />
            {{ preview() ? 'Hide the preview' : 'Preview' }}
          </button>
          <button
            uiButton
            variant="secondary"
            type="button"
            [loading]="busy() === 'test'"
            [disabled]="busy() !== null || !canTest()"
            [attr.title]="
              canTest()
                ? null
                : 'Pick a person with an email, and set up email on the server'
            "
            (click)="sendTest()"
          >
            <ui-icon name="mail" [size]="16" /> Send a test now
          </button>
        </div>
        @if (notice(); as text) {
          <ui-alert tone="success" class="li-block" role="status">{{
            text
          }}</ui-alert>
        }
        @if (preview(); as p) {
          <p class="li-muted li-small">
            Subject: <strong>{{ p.digest.subject }}</strong>
          </p>
          <iframe
            class="preview"
            title="Preview of the email digest"
            sandbox="allow-popups allow-popups-to-escape-sandbox"
            [srcdoc]="p.html"
          ></iframe>
        }
        @if (s.sends.length) {
          <ul class="sends" aria-label="Last digests">
            @for (send of s.sends; track send.period) {
              <li>
                <ui-badge [tone]="badge(send).tone">{{
                  badge(send).text
                }}</ui-badge>
                <span>{{ period(send) }}</span>
                @if (send.recipient) {
                  <span class="li-muted">to {{ send.recipient }}</span>
                }
                @if (send.error) {
                  <span class="li-muted li-small">{{ send.error }}</span>
                }
              </li>
            }
          </ul>
        }
      } @else if (!error()) {
        <p class="li-muted">Loading…</p>
      }
    </ui-card>
  `,
})
export class DigestCard {
  private readonly api = inject(AgendaApi);
  private readonly sanitizer = inject(DomSanitizer);

  protected readonly status = signal<DigestStatusDto | null>(null);
  protected readonly preview = signal<{
    digest: DigestDto;
    html: SafeHtml;
  } | null>(null);
  protected readonly busy = signal<'preview' | 'test' | null>(null);
  protected readonly error = signal<string | null>(null);
  protected readonly notice = signal<string | null>(null);
  protected readonly settings = DIGEST_SETTINGS_LINK;
  protected readonly moment = momentText;
  protected readonly period = periodText;

  protected readonly canTest = computed(() => {
    const s = this.status();
    return !!s?.mailConfigured && !!s.recipient?.email;
  });

  constructor() {
    this.load();
  }

  load(): void {
    this.api.digest().subscribe({
      next: (status) => {
        this.status.set(status);
        this.error.set(null);
      },
      error: (error: unknown) =>
        this.error.set(
          errorText(error, 'Could not read the email digest.', SERVICE),
        ),
    });
  }

  protected personLink(id: string) {
    return entityLink({ kind: 'person', id, status: 'confirmed' });
  }

  protected badge(send: DigestSendDto) {
    return SEND_BADGES[send.status];
  }

  protected togglePreview(): void {
    if (this.preview()) {
      this.preview.set(null);
      return;
    }
    this.busy.set('preview');
    this.api.previewDigest().subscribe({
      next: (digest) => {
        this.busy.set(null);
        // The digest is the service's own HTML, every value in it escaped;
        // the frame is sandboxed (no scripts), and its links open a new tab.
        this.preview.set({
          digest,
          html: this.sanitizer.bypassSecurityTrustHtml(
            digest.html.replace('<head>', '<head><base target="_blank">'),
          ),
        });
      },
      error: (error: unknown) => {
        this.busy.set(null);
        this.error.set(
          errorText(error, 'Could not build the preview.', SERVICE),
        );
      },
    });
  }

  protected sendTest(): void {
    this.busy.set('test');
    this.notice.set(null);
    this.error.set(null);
    this.api.testDigest().subscribe({
      next: (sent) => {
        this.busy.set(null);
        this.notice.set(`Sent to ${sent.to}: “${sent.subject}”.`);
        this.load();
      },
      error: (error: unknown) => {
        this.busy.set(null);
        this.error.set(errorText(error, 'Could not send it.', SERVICE));
        this.load();
      },
    });
  }
}
