import { HttpClient } from '@angular/common/http';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  output,
  signal,
  type OnInit,
} from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import type {
  AgendaEntryDto,
  AgendaWaitingDto,
  NeedsYouDto,
} from '@life-island/contracts';
import { UiButton, UiCard, UiIcon } from '@life-island/design-system';
import { dateText, euro } from './format';
import { LiDue } from './page-parts';

/** One line of the block: a dated thing or one that waits with no date. */
export interface NeedsYouLine {
  key: string;
  title: string;
  /** Under the title: the detail, the amount, since when it waits. */
  meta: string[];
  /** Days left for a dated thing (negative once late); null for a waiting one. */
  daysLeft: number | null;
  /** The button that opens where it is handled, or null when it is this page. */
  open: { label: string; path: string; query: Record<string, string> } | null;
  /** The Agenda key a dated thing is marked done with; null for a waiting one. */
  doneKey: string | null;
}

/** `/cars?vehicle=1` as a router path and its query. */
function splitPath(path: string): {
  path: string;
  query: Record<string, string>;
} {
  const [pathname, search = ''] = path.split('?');
  return {
    path: pathname,
    query: Object.fromEntries(new URLSearchParams(search)),
  };
}

/**
 * The lines of the block, most urgent first: late and due dates by days
 * left, then what waits with no date (oldest first, as the Agenda sends
 * them). A line opens its place only when that is not the page shown.
 */
export function needsYouLines(
  needs: Pick<NeedsYouDto, 'entries' | 'waiting'>,
  currentPath: string,
): NeedsYouLine[] {
  const here = currentPath.split('?')[0].replace(/\/$/, '') || '/';
  const openOf = (path: string | null, label: string) => {
    if (!path || !path.startsWith('/')) return null;
    const target = splitPath(path);
    const same =
      (target.path.replace(/\/$/, '') || '/') === here &&
      !Object.keys(target.query).length;
    return same ? null : { label, ...target };
  };
  const dated = needs.entries
    .filter((e) => !e.handled)
    .map((e: AgendaEntryDto): NeedsYouLine => ({
      key: e.key,
      title: e.title,
      meta: [
        e.detail,
        e.amount !== null ? euro(e.amount) : null,
        e.time,
      ].filter((m): m is string => !!m),
      daysLeft: e.daysLeft,
      open: openOf(e.path, 'Open'),
      doneKey: e.key,
    }))
    .sort((a, b) => (a.daysLeft ?? 0) - (b.daysLeft ?? 0));
  const waiting = needs.waiting.map((w: AgendaWaitingDto): NeedsYouLine => ({
    key: w.key,
    title: w.title,
    meta: [
      w.detail,
      w.since ? `waiting since ${dateText(w.since)}` : null,
    ].filter((m): m is string => !!m),
    daysLeft: null,
    // A waiting thing always has its own button: it is what handles it.
    open: { label: w.action, ...splitPath(w.path) },
    doneKey: null,
  }));
  // Late dates first, then what waits, then what is coming.
  return [
    ...dated.filter((l) => (l.daysLeft ?? 0) < 0),
    ...waiting,
    ...dated.filter((l) => (l.daysLeft ?? 0) >= 0),
  ];
}

/**
 * "Needs you", the second block of every area page (design guidelines,
 * section 1): what the area needs from you now, most urgent first, at most
 * five lines, each with the button that does it. Read from the Agenda
 * (`GET /api/agenda/needs?module=`), so it matches the Agenda, the island's
 * badge and the email digest, handled marks included. Nothing needed, or
 * the Agenda not reachable: the block is not shown.
 */
@Component({
  selector: 'li-needs-you',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [LiDue, RouterLink, UiButton, UiCard, UiIcon],
  template: `
    @if (lines().length) {
      <ui-card heading="Needs you" class="needs li-block">
        <a uiCardActions class="needs__all li-small" routerLink="/agenda"
          >All dates in the Agenda</a
        >
        <ul class="li-list">
          @for (line of shown(); track line.key) {
            <li class="needs__line">
              <span class="needs__when">
                @if (line.daysLeft !== null) {
                  <li-due [days]="line.daysLeft" [warnDays]="7" />
                } @else {
                  <span class="needs__waiting">Waiting</span>
                }
              </span>
              <span class="needs__body">
                <span class="needs__title">{{ line.title }}</span>
                @if (line.meta.length) {
                  <span class="li-meta">
                    @for (m of line.meta; track $index) {
                      <span>{{ m }}</span>
                    }
                  </span>
                }
              </span>
              <span class="needs__actions">
                @if (line.open; as open) {
                  <a
                    uiButton
                    variant="secondary"
                    size="sm"
                    [routerLink]="open.path"
                    [queryParams]="open.query"
                    [attr.aria-label]="open.label + ': ' + line.title"
                    >{{ open.label }}</a
                  >
                }
                @if (line.doneKey) {
                  <button
                    uiButton
                    variant="ghost"
                    size="sm"
                    type="button"
                    [disabled]="busy() === line.key"
                    [attr.aria-label]="'Mark done: ' + line.title"
                    (click)="markDone(line)"
                  >
                    <ui-icon name="check" [size]="16" /> Done
                  </button>
                }
              </span>
            </li>
          }
        </ul>
        @if (lines().length > max()) {
          <p class="li-muted li-small needs__more">
            And {{ lines().length - max() }} more:
            <a routerLink="/agenda">see them in the Agenda</a>.
          </p>
        }
        @if (error()) {
          <p class="li-small needs__error" role="alert">{{ error() }}</p>
        }
      </ui-card>
    }
  `,
  styles: `
    :host {
      display: block;
    }
    .needs__all {
      color: var(--text-secondary);
    }
    .needs__line {
      display: grid;
      grid-template-columns: 7rem minmax(0, 1fr) auto;
      gap: var(--space-3);
      align-items: center;
    }
    .needs__body {
      display: grid;
      gap: var(--space-1);
      min-width: 0;
    }
    .needs__title {
      font-weight: 600;
    }
    .needs__waiting {
      display: inline-flex;
      padding: 0 var(--space-2);
      border-radius: var(--radius-full);
      background: var(--tone-info-soft);
      color: var(--tone-info);
      font-size: var(--text-xs);
      font-weight: 600;
    }
    .needs__actions {
      display: flex;
      flex-wrap: wrap;
      gap: var(--space-2);
      justify-content: flex-end;
    }
    .needs__more,
    .needs__error {
      margin: var(--space-3) 0 0;
    }
    .needs__error {
      color: var(--tone-danger);
    }
    @media (max-width: 40rem) {
      .needs__line {
        grid-template-columns: minmax(0, 1fr);
        gap: var(--space-2);
      }
      .needs__actions {
        justify-content: flex-start;
      }
    }
  `,
})
export class LiNeedsYou implements OnInit {
  private readonly http = inject(HttpClient);
  private readonly router = inject(Router);

  /** The island area, as the Agenda names it: `cars`, `home`, `taxes`… */
  readonly module = input.required<string>();
  /** At most this many lines; the rest are counted, with the Agenda's link. */
  readonly max = input(5);
  /** A date was marked done here: the page may reload what it shows. */
  readonly handled = output<string>();

  private readonly needs = signal<NeedsYouDto | null>(null);
  protected readonly busy = signal<string | null>(null);
  protected readonly error = signal<string | null>(null);

  protected readonly lines = computed(() => {
    const needs = this.needs();
    return needs ? needsYouLines(needs, this.router.url) : [];
  });
  protected readonly shown = computed(() => this.lines().slice(0, this.max()));

  ngOnInit(): void {
    this.load();
  }

  /** Reads it again (after the page changed something it lists). */
  load(): void {
    this.http
      .get<NeedsYouDto>('/api/agenda/needs', {
        params: { module: this.module() },
      })
      .subscribe({
        next: (needs) => this.needs.set(needs),
        // The Agenda not running: the page shows without the block.
        error: () => this.needs.set(null),
      });
  }

  protected markDone(line: NeedsYouLine): void {
    if (!line.doneKey) return;
    this.busy.set(line.key);
    this.error.set(null);
    this.http
      .put<void>('/api/agenda/handled', { key: line.doneKey, handled: true })
      .subscribe({
        next: () => {
          this.busy.set(null);
          this.needs.update((needs) =>
            needs
              ? {
                  ...needs,
                  entries: needs.entries.filter((e) => e.key !== line.doneKey),
                }
              : needs,
          );
          this.handled.emit(line.doneKey!);
        },
        error: () => {
          this.busy.set(null);
          this.error.set('Could not mark it done. Is the Agenda running?');
        },
      });
  }
}
