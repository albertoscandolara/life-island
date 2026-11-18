import { DatePipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  inject,
  signal,
} from '@angular/core';
import type {
  CalendarFeedDto,
  CalendarFeedLinkDto,
} from '@life-island/contracts';
import {
  UiAlert,
  UiButton,
  UiCard,
  UiIcon,
  UiInput,
} from '@life-island/design-system';
import { errorText } from '@life-island/records-ui';
import { AgendaApi } from '../api/agenda-api';

const SERVICE = 'svc-agenda';

/**
 * The private calendar link: the Agenda's dates in your phone's or computer's
 * calendar, kept up to date by the calendar app. The link holds a secret, so
 * it is shown once when made; a new one or turning it off stops the old one.
 */
@Component({
  selector: 'agenda-calendar-card',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DatePipe, UiAlert, UiButton, UiCard, UiIcon, UiInput],
  styles: `
    .link {
      display: flex;
      flex-wrap: wrap;
      gap: var(--space-2);
      align-items: center;
      margin: var(--space-3) 0;
    }
    .link input {
      flex: 1 1 22rem;
      min-inline-size: 0;
      font-family: var(--font-mono, monospace);
      font-size: var(--text-sm);
    }
    .apps {
      margin: var(--space-2) 0 0;
      padding-left: var(--space-5);
      display: grid;
      gap: var(--space-1);
    }
    .actions {
      display: flex;
      flex-wrap: wrap;
      gap: var(--space-2);
      margin-top: var(--space-3);
    }
  `,
  template: `
    <ui-card heading="Calendar link" class="li-block">
      <p class="li-intro li-muted">
        Every date of the Agenda in the calendar of your phone or computer, kept
        up to date by it: from a month ago to a year ahead, read-only. The link
        works without signing in, so treat it like a password: anyone who has it
        sees your dates, titles and amounts.
      </p>
      @if (error(); as message) {
        <ui-alert tone="danger" class="li-block">{{ message }}</ui-alert>
      }
      @if (made(); as link) {
        <ui-alert tone="success" role="status">
          Here is your link. It is shown only now: copy it and add it to your
          calendar. Lost it? Make a new one.
        </ui-alert>
        <div class="link">
          <input
            uiInput
            readonly
            aria-label="Your private calendar link"
            [value]="link.url"
            (focus)="$any($event.target).select()"
          />
          <button uiButton type="button" (click)="copy(link.url)">
            @if (copied()) {
              <ui-icon name="check" [size]="16" /> Copied
            } @else {
              Copy the link
            }
          </button>
        </div>
        <ul class="apps li-small">
          <li>
            <strong>Google Calendar</strong> (on a computer): Other calendars,
            +, From URL, then paste it.
          </li>
          <li>
            <strong>Apple Calendar</strong>: File, New Calendar Subscription (on
            iPhone: Settings, Calendar, Accounts, Add Subscribed Calendar).
          </li>
          <li><strong>Outlook</strong>: Add calendar, Subscribe from web.</li>
        </ul>
      }
      @if (status(); as s) {
        @if (s.active) {
          @if (!made()) {
            <p>
              <ui-icon name="check" [size]="16" /> A link is on since
              {{ s.createdAt | date: 'd MMM y' }}.
              @if (s.lastReadAt) {
                <span class="li-muted"
                  >A calendar last read it
                  {{ s.lastReadAt | date: 'd MMM y, HH:mm' }}.</span
                >
              } @else {
                <span class="li-muted">No calendar has read it yet.</span>
              }
            </p>
          }
          <div class="actions">
            <button
              uiButton
              variant="secondary"
              type="button"
              [loading]="busy() === 'new'"
              [disabled]="busy() !== null"
              (click)="newLink()"
            >
              <ui-icon name="refresh" [size]="16" /> Make a new link
            </button>
            <button
              uiButton
              variant="ghost"
              type="button"
              [loading]="busy() === 'off'"
              [disabled]="busy() !== null"
              (click)="turnOff()"
            >
              <ui-icon name="x" [size]="16" /> Turn it off
            </button>
          </div>
          <p class="li-muted li-small">
            A new link stops the old one at once, everywhere it was added.
          </p>
        } @else {
          <button
            uiButton
            type="button"
            [loading]="busy() === 'new'"
            [disabled]="busy() !== null"
            (click)="newLink()"
          >
            <ui-icon name="calendar" [size]="16" /> Make a private link
          </button>
        }
      } @else if (!error()) {
        <p class="li-muted">Loading…</p>
      }
    </ui-card>
  `,
})
export class CalendarCard {
  private readonly api = inject(AgendaApi);

  protected readonly status = signal<CalendarFeedDto | null>(null);
  /** The link just made, shown this once. */
  protected readonly made = signal<CalendarFeedLinkDto | null>(null);
  protected readonly busy = signal<'new' | 'off' | null>(null);
  protected readonly copied = signal(false);
  protected readonly error = signal<string | null>(null);

  constructor() {
    this.api.calendar().subscribe({
      next: (status) => this.status.set(status),
      error: (error: unknown) =>
        this.error.set(
          errorText(error, 'Could not read the calendar link.', SERVICE),
        ),
    });
  }

  protected newLink(): void {
    this.busy.set('new');
    this.error.set(null);
    this.copied.set(false);
    this.api.newCalendarLink().subscribe({
      next: (link) => {
        this.busy.set(null);
        this.made.set(link);
        this.status.set(link);
      },
      error: (error: unknown) => {
        this.busy.set(null);
        this.error.set(errorText(error, 'Could not make the link.', SERVICE));
      },
    });
  }

  protected turnOff(): void {
    this.busy.set('off');
    this.error.set(null);
    this.api.removeCalendarLink().subscribe({
      next: () => {
        this.busy.set(null);
        this.made.set(null);
        this.status.set({ active: false, createdAt: null, lastReadAt: null });
      },
      error: (error: unknown) => {
        this.busy.set(null);
        this.error.set(errorText(error, 'Could not turn it off.', SERVICE));
      },
    });
  }

  protected copy(url: string): void {
    void navigator.clipboard
      ?.writeText(url)
      .then(() => this.copied.set(true))
      .catch(() => undefined);
  }
}
